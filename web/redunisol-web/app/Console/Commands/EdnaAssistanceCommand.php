<?php

namespace App\Console\Commands;

use App\Jobs\ProcessEdnaAssistance;
use App\Jobs\ReconcileEdnaAssistance;
use App\Services\EdnaAssistance;
use App\Services\EdnaBitrix;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Throwable;

class EdnaAssistanceCommand extends Command
{
    protected $signature = 'edna:assistance {action=status : status, poll, schema, process, reconcile or prune}
        {case? : Internal case ID} {--dispatch : Explicitly enqueue pilot actions}
        {--apply : Create missing schema or apply retention}';

    protected $description = 'Inspect the isolated Jubilados pilot; no sending or CRM changes by default';

    public function handle(): int
    {
        try {
            $action = $this->argument('action');
            if ($action === 'poll') {
                $this->line(json_encode((new EdnaAssistance)->poll((bool) $this->option('dispatch'))));
            } elseif ($action === 'status') {
                $query = DB::table('edna_assistance_cases');
                if ($this->argument('case')) {
                    $query->where('id', (int) $this->argument('case'));
                }
                $this->line(json_encode($query->select('state', 'crm_state', 'reason')->selectRaw('count(*) as cases')
                    ->groupBy('state', 'crm_state', 'reason')->get()));
            } elseif ($action === 'schema') {
                $incomplete = false;
                foreach (['contact', 'lead', 'deal'] as $entity) {
                    $missing = (new EdnaBitrix)->assistanceSchema($entity, (bool) $this->option('apply'));
                    if ($this->option('apply')) {
                        $missing = (new EdnaBitrix)->assistanceSchema($entity);
                    }
                    $incomplete = $incomplete || count($missing) > 0;
                    $this->line(json_encode(['entity' => $entity, 'missing' => $missing]));
                }
                if ($incomplete) {
                    return self::FAILURE;
                }
            } elseif ($action === 'prune') {
                $query = DB::table('edna_assistance_cases')->where('updated_at', '<', now()->subDays(30))
                    ->whereIn('state', ['completed', 'suppressed', 'rejected', 'review', 'answered'])
                    ->whereIn('crm_state', ['synced', 'preview', 'not_applicable'])
                    ->where(function ($q) {
                        $q->whereNull('link_state')->orWhereIn('link_state', ['confirmed', 'rejected', 'suppressed']);
                    })->whereNotNull('recipient');
                $this->line(json_encode(['eligible' => $query->count(), 'applied' => (bool) $this->option('apply')]));
                if ($this->option('apply')) {
                    $query->update(['recipient' => null, 'answer' => null, 'link_text' => null]);
                    DB::table('edna_assistance_form_receipts')->where('submitted_at', '<', now()->subDays(30))->delete();
                }
            } elseif (in_array($action, ['process', 'reconcile'], true)) {
                $case = DB::table('edna_assistance_cases')->find((int) $this->argument('case'));
                if (! $case || ! $this->option('dispatch')) {
                    $this->error('Provide a case ID and --dispatch. Inspect status first.');

                    return self::FAILURE;
                }
                if ($action === 'process') {
                    // Never replay unknown CRM writes. Only a preview has no remote effects.
                    if ($case->crm_state !== 'preview' || ! config('edna.assistance_crm_enabled')
                        || ! $case->recipient || ! (new EdnaAssistance)->allowed(Crypt::decryptString($case->recipient))) {
                        return self::FAILURE;
                    }
                    DB::table('edna_assistance_cases')->where('id', $case->id)->where('crm_state', 'preview')
                        ->update(['crm_state' => 'pending', 'updated_at' => now()]);
                    Queue::connection('edna_assistance')->push(new ProcessEdnaAssistance($case->id), '', 'edna-assistance');
                } else {
                    Queue::connection('edna_assistance')->push(new ReconcileEdnaAssistance($case->id), '', 'edna-assistance');
                    Queue::connection('edna_assistance')->push(new ReconcileEdnaAssistance($case->id, true), '', 'edna-assistance');
                }
            } else {
                return self::FAILURE;
            }

            return self::SUCCESS;
        } catch (Throwable) {
            $this->error('Assistance operation failed; inspect configuration and case state. Secrets suppressed.');

            return self::FAILURE;
        }
    }
}
