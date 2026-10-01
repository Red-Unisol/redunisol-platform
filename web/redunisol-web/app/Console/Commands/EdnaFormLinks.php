<?php

namespace App\Console\Commands;

use App\Jobs\ReconcileEdnaFormLink;
use App\Jobs\SyncEdnaFormLink;
use App\Services\EdnaFormLink;
use App\Services\EdnaFormRequest;
use App\Services\EdnaFormTemplate;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Throwable;

class EdnaFormLinks extends Command
{
    protected $signature = 'edna:form-links {action=status : status, schema, layout, template, poll, sync, reconcile or prune}
        {id? : Entry event ID for sync; send ID for reconcile} {--apply : Apply schema/template or retention changes}';

    protected $description = 'Manage advisor form links and explicit CRM send requests';

    public function handle(): int
    {
        try {
            $action = $this->argument('action');
            if ($action === 'prune') {
                $contexts = DB::table('edna_form_links')->where('last_received_at', '<', now()->subDays(30))
                    ->whereNotExists(function ($query): void {
                        $query->selectRaw('1')->from('edna_form_link_sends')
                            ->whereColumn('edna_form_link_sends.scope', 'edna_form_links.scope')
                            ->whereNotIn('state', ['confirmed', 'rejected', 'cancelled']);
                    });
                $sends = DB::table('edna_form_link_sends')->where('created_at', '<', now()->subDays(30))
                    ->whereIn('state', ['confirmed', 'rejected', 'cancelled'])->whereNotNull('recipient');
                $this->line(json_encode(['contexts' => $this->option('apply') ? $contexts->delete() : $contexts->count(),
                    'recipients' => $this->option('apply') ? $sends->update(['recipient' => null, 'content' => null]) : $sends->count()]));

                return self::SUCCESS;
            }
            if (in_array($action, ['schema', 'layout'], true)) {
                $missing = [];
                foreach (['contact', 'lead'] as $entity) {
                    $missing[$entity] = (new EdnaFormLink)->{$action}($entity, (bool) $this->option('apply'));
                }
                $this->line(json_encode($missing));

                return array_filter($missing) ? self::FAILURE : self::SUCCESS;
            }
            if ($action === 'template') {
                $result = (new EdnaFormTemplate)->inspect((bool) $this->option('apply'));
                $this->line(json_encode($result));

                return ($result['status'] ?? '') === 'APPROVED' ? self::SUCCESS : self::FAILURE;
            }
            if ($action === 'poll') {
                $this->line(json_encode(['requests' => (new EdnaFormRequest)->poll()]));

                return self::SUCCESS;
            }
            if ($action === 'status') {
                $this->line(json_encode(['contexts' => DB::table('edna_form_links')->orderByDesc('entry_event_id')->limit(50)
                    ->get(['entry_event_id', 'entry_received_at', 'crm_entity', 'crm_id', 'crm_state', 'crm_reason']),
                    'sends' => DB::table('edna_form_link_sends')->latest('id')->limit(50)
                        ->get(['id', 'entry_event_id', 'state', 'reason', 'outgoing_message_id'])]));

                return self::SUCCESS;
            }
            $id = $this->argument('id');
            if (! $id || ! ctype_digit((string) $id)) {
                return self::FAILURE;
            }
            if ($action === 'sync') {
                $context = DB::table('edna_form_links')->where('entry_event_id', $id)->first();
                if (! $context) {
                    return self::FAILURE;
                }
                DB::table('edna_form_links')->where('scope', $context->scope)->where('entry_event_id', $id)
                    ->update(['crm_state' => 'pending', 'crm_reason' => null]);
                Queue::connection('edna')->push(new SyncEdnaFormLink($context->scope, (int) $id), '', 'edna');
            } elseif ($action === 'reconcile') {
                Queue::connection('edna')->push(new ReconcileEdnaFormLink((int) $id), '', 'edna');
            } else {
                return self::FAILURE;
            }
            $this->info('Recovery queued; no WhatsApp resend.');

            return self::SUCCESS;
        } catch (Throwable) {
            $this->error('Form link operation not confirmed. Check configuration, permissions and status before retrying.');

            return self::FAILURE;
        }
    }
}
