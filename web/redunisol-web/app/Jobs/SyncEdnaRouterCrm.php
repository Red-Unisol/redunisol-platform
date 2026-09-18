<?php

namespace App\Jobs;

use App\Services\EdnaBitrix;
use App\Services\EdnaFlowRouter;
use App\Services\EdnaRouterResult;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class SyncEdnaRouterCrm implements ShouldQueue
{
    use Queueable;

    public int $tries = 8;

    public int $timeout = 40;

    public function __construct(public readonly int $resultId) {}

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300, 600, 1800];
    }

    public function handle(): void
    {
        try {
            $this->resolveTarget();
            DB::transaction(function (): void {
                $initial = DB::table('edna_router_results')->find($this->resultId);
                $send = $initial ? DB::table('edna_flow_sends')->find($initial->flow_send_id) : null;
                if (! $send) {
                    return;
                }
                // Serializes writes for consecutive cycles of the same contact, not just one job.
                DB::table('edna_router_contacts')->where('scope', $send->scope)->lockForUpdate()->first();
                $result = DB::table('edna_router_results')->where('id', $this->resultId)->lockForUpdate()->first();
                if (in_array($result->crm_state, ['synced', 'superseded', 'cancelled'], true)) {
                    return;
                }
                if (! (new EdnaRouterResult)->eligible($send)) {
                    $this->record('cancelled', 'router_disabled_or_outside_pilot');

                    return;
                }
                $api = new EdnaBitrix;
                $phone = Crypt::decryptString($send->recipient);
                if (! $result->crm_id) {
                    return;
                }
                $target = ['entity' => $result->crm_entity, 'id' => $result->crm_id];
                $entity = $target['entity'];
                if (! in_array($entity, ['contact', 'lead'], true) || $api->schema($entity)) {
                    throw new RuntimeException('CRM WA fields require provisioning.');
                }
                $record = $api->call('crm.'.$entity.'.get', ['id' => $target['id']]);
                if (! is_array($record) || (string) ($record['ID'] ?? '') !== $target['id'] || ! $api->samePhone($record, $phone)) {
                    $this->record('review', 'identity_mismatch');

                    return;
                }
                if ($entity === 'lead' && ($record['STATUS_SEMANTIC_ID'] ?? '') !== 'P') {
                    $this->record('review', 'lead_not_active');

                    return;
                }
                $received = CarbonImmutable::parse($result->response_received_at);
                $previous = $record['UF_CRM_WA_TIMESTAMP'] ?? null;
                if ($previous && CarbonImmutable::parse($previous)->gt($received)) {
                    $this->record('superseded', 'newer_router_result');

                    return;
                }
                $fields = [
                    'UF_CRM_WA_ASSISTED' => 'SI', 'UF_CRM_WA_ENTRY' => 'website',
                    'UF_CRM_WA_FLOW' => 'web_whatsapp_router', 'UF_CRM_WA_PROVINCE' => $result->province,
                    'UF_CRM_WA_SEGMENT' => $result->segment, 'UF_CRM_WA_FLOW_ID' => EdnaFlowRouter::FLOW_ID,
                    'UF_CRM_WA_TIMESTAMP' => $received->toIso8601String(),
                ];
                // Only these seven fields: no SOURCE_ID, UTMs, owner, status, name or phone.
                // Read before writing also resolves an update whose HTTP response was lost.
                if (! $this->matches($record, $fields)) {
                    if ($api->call('crm.'.$entity.'.update', ['id' => $target['id'], 'fields' => $fields]) !== true) {
                        throw new RuntimeException('CRM update not acknowledged.');
                    }
                    $record = $api->call('crm.'.$entity.'.get', ['id' => $target['id']]);
                    if (! is_array($record) || ! $this->matches($record, $fields)) {
                        throw new RuntimeException('CRM read-back does not match.');
                    }
                }
                DB::table('edna_router_results')->where('id', $this->resultId)->update([
                    'crm_state' => 'synced', 'crm_reason' => null, 'crm_entity' => $entity, 'crm_id' => $target['id'],
                    'crm_synced_at' => now(), 'updated_at' => now(),
                ]);
            });
        } catch (Throwable) {
            throw new RuntimeException('Edna CRM sync unconfirmed; inspect the result ID.');
        }
    }

    private function resolveTarget(): void
    {
        // Pin the selected record durably BEFORE any remote update. A lost acknowledgement
        // must never cause a retry to switch to a different matching CRM record.
        DB::transaction(function (): void {
            $result = DB::table('edna_router_results')->where('id', $this->resultId)->lockForUpdate()->first();
            if (! $result || $result->crm_id || in_array($result->crm_state, ['synced', 'superseded', 'cancelled'], true)) {
                return;
            }
            $send = DB::table('edna_flow_sends')->find($result->flow_send_id);
            if (! $send || ! (new EdnaRouterResult)->eligible($send)) {
                return;
            }
            $target = (new EdnaBitrix)->find(Crypt::decryptString($send->recipient));
            if (isset($target['reason'])) {
                if ($target['reason'] === 'record_not_found') {
                    throw new RuntimeException('CRM record not yet available.');
                }
                $this->record('review', $target['reason']);

                return;
            }
            DB::table('edna_router_results')->where('id', $this->resultId)->update([
                'crm_entity' => $target['entity'], 'crm_id' => $target['id'], 'updated_at' => now(),
            ]);
        });
    }

    private function matches(array $record, array $fields): bool
    {
        foreach ($fields as $key => $value) {
            if ($key === 'UF_CRM_WA_TIMESTAMP') {
                if (empty($record[$key]) || ! CarbonImmutable::parse($record[$key])->eq(CarbonImmutable::parse($value))) {
                    return false;
                }
            } elseif (($record[$key] ?? null) !== $value) {
                return false;
            }
        }

        return true;
    }

    private function record(string $state, string $reason): void
    {
        DB::table('edna_router_results')->where('id', $this->resultId)
            ->update(['crm_state' => $state, 'crm_reason' => $reason, 'updated_at' => now()]);
    }

    public function failed(?Throwable $exception): void
    {
        DB::table('edna_router_results')->where('id', $this->resultId)->whereNotIn('crm_state', ['synced', 'superseded', 'cancelled'])
            ->update(['crm_state' => 'failed', 'crm_reason' => 'sync_exhausted', 'updated_at' => now()]);
    }
}
