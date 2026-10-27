<?php

namespace App\Console\Commands;

use App\Jobs\ProcessEdnaIntake;
use App\Services\EdnaIntake;
use App\Services\EdnaIntakePilot;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class EdnaIntakeCommand extends Command
{
    protected $signature = 'edna:intake {action=status : status, pilot, recover or prune} {id?}
        {--expected-case= : Original request UUID, required to recover}
        {--confirmed-no-writes : Operator verified the failed execution made no CRM writes}
        {--apply : Apply the selected recovery or retention operation}';

    protected $description = 'Inspect intake and recover an audited pre-write failure without sending another Flow';

    public function handle(): int
    {
        if ($this->argument('action') === 'pilot') {
            $this->line(json_encode([
                'limit' => EdnaIntakePilot::CAPACITY,
                'pilots' => DB::table('edna_intake_pilots')->latest('created_at')->limit(50)
                    ->get(['id', 'name', 'subject_id', 'flow_id', 'admitted', 'created_at']),
                'participants' => DB::table('edna_intake_admissions as a')
                    ->leftJoin('edna_flow_sends as s', 's.intake_admission_id', '=', 'a.id')
                    ->leftJoin('edna_intake_requests as r', 'r.flow_send_id', '=', 's.id')
                    ->orderByDesc('a.id')->limit(100)->get(['a.id', 'a.pilot_key', 'a.slot',
                        's.id as flow_send_id', 's.state as send_state', 'r.state as intake_state', 'r.lead_id', 'r.contact_id']),
            ]));

            return self::SUCCESS;
        }
        if ($this->argument('action') === 'recover') {
            return $this->recover();
        }
        $query = DB::table('edna_intake_requests');
        if ($this->argument('action') === 'status') {
            $id = $this->argument('id');
            if ($id !== null && ! ctype_digit((string) $id)) {
                return self::FAILURE;
            }
            $this->line(json_encode($query->when($id !== null, fn ($q) => $q->where('id', $id))
                ->latest('id')->limit(50)->get(['id', 'flow_send_id', 'response_event_id', 'state', 'reason', 'lead_id', 'contact_id', 'created_at'])));

            return self::SUCCESS;
        }
        if ($this->argument('action') === 'prune') {
            // Review/unknown records retain their encrypted answer until reconciliation.
            $query->where('state', 'synced')->where('updated_at', '<', now()->subDays(30))->whereNotNull('answer');
            $count = $query->count();
            if ($this->option('apply')) {
                $query->update(['answer' => null]);
            }
            $this->line(json_encode(['eligible' => $count, 'applied' => (bool) $this->option('apply')]));

            return self::SUCCESS;
        }

        return self::FAILURE;
    }

    private function recover(): int
    {
        $id = $this->argument('id');
        if ($id === null || ! ctype_digit((string) $id) || (int) $id < 1) {
            return self::FAILURE;
        }
        try {
            $result = DB::transaction(function () use ($id): array {
                $request = DB::table('edna_intake_requests')->where('id', $id)->lockForUpdate()->first();
                $send = $request ? DB::table('edna_flow_sends')->find($request->flow_send_id) : null;
                if (! $request || ! $send) {
                    throw new RuntimeException('Unknown stored intake.');
                }
                $result = ['id' => $request->id, 'case_id' => $send->request_id,
                    'flow_send_id' => $send->id, 'admission_id' => $send->intake_admission_id,
                    'state' => $request->state, 'applied' => false];
                if (! $this->option('apply')) {
                    return $result;
                }
                $expected = (string) $this->option('expected-case');
                if (! $this->option('confirmed-no-writes') || ! Str::isUuid($expected)
                    || ! hash_equals($send->request_id, $expected)) {
                    throw new RuntimeException('Recovery requires the original UUID and verified absence of CRM writes.');
                }
                if ($request->state === 'synced') {
                    return $result + ['action' => 'already_synced'];
                }
                if ($request->state !== 'unknown' || $request->reason !== 'crm_acknowledgement_uncertain'
                    || ! $request->answer || $send->state !== 'completed'
                    || (int) $send->response_event_id !== (int) $request->response_event_id
                    || ! config('edna.intake_crm_enabled') || ! (new EdnaIntake)->canSend($send)) {
                    throw new RuntimeException('Stored intake is not eligible for pre-write recovery.');
                }
                // The inbox, Flow send, UUID and admission remain unchanged; no new slot or message.
                DB::table('edna_intake_requests')->where('id', $request->id)->update([
                    'state' => 'pending', 'reason' => 'operator_verified_prewrite_recovery', 'updated_at' => now(),
                ]);
                Queue::connection('edna')->push(new ProcessEdnaIntake($request->id), '', 'edna');

                return array_replace($result, ['state' => 'pending', 'applied' => true, 'action' => 'recovery_queued']);
            });
            $this->line(json_encode($result));

            return self::SUCCESS;
        } catch (Throwable) {
            $this->error('Recovery not applied. Verify the case, original execution, stored response and current state.');

            return self::FAILURE;
        }
    }
}
