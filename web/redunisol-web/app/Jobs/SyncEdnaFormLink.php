<?php

namespace App\Jobs;

use App\Services\AttributionJourney;
use App\Services\EdnaBitrix;
use App\Services\EdnaFormLink;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class SyncEdnaFormLink implements ShouldQueue
{
    use Queueable;

    public int $tries = 8;

    public int $timeout = 40;

    public function __construct(public readonly string $scope, public readonly int $entryEventId) {}

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300, 600, 1800];
    }

    public function handle(): void
    {
        if (! config('edna.form_links_enabled')) {
            return;
        }
        try {
            // Pin the target durably before the remote update, including on lost acknowledgements.
            DB::transaction(function (): void {
                $context = $this->locked();
                if (! $context || $context->crm_id || $context->crm_state === 'review') {
                    return;
                }
                $target = (new EdnaBitrix)->find(Crypt::decryptString($context->recipient));
                if (($target['reason'] ?? '') === 'record_not_found') {
                    throw new RuntimeException('CRM record not yet available.');
                }
                $this->record(isset($target['reason'])
                    ? ['crm_state' => 'review', 'crm_reason' => $target['reason']]
                    : ['crm_entity' => $target['entity'], 'crm_id' => $target['id']]);
            });
            DB::transaction(function (): void {
                $context = $this->locked();
                if (! $context || ! $context->crm_id || in_array($context->crm_state, ['review', 'synced'], true)) {
                    return;
                }
                $links = new EdnaFormLink;
                if ($links->schema($context->crm_entity)) {
                    throw new RuntimeException('Form link field is missing.');
                }
                $api = new EdnaBitrix;
                $record = $api->call('crm.'.$context->crm_entity.'.get', ['id' => $context->crm_id]);
                $journeys = new AttributionJourney;
                $hash = $journeys->phoneHash(Crypt::decryptString($context->recipient));
                $matches = collect($record['PHONE'] ?? [])->contains(fn ($p) => $hash
                    && $journeys->phoneHash((string) ($p['VALUE'] ?? '')) === $hash);
                if ((string) ($record['ID'] ?? '') !== $context->crm_id || ! $matches
                    || ($context->crm_entity === 'lead' && ($record['STATUS_SEMANTIC_ID'] ?? '') !== 'P')) {
                    $this->record(['crm_state' => 'review', 'crm_reason' => 'identity_or_stage_changed']);

                    return;
                }
                $url = $links->url($context);
                $status = $links->canSendTo(Crypt::decryptString($context->recipient)) ? 'Listo para solicitar envío.'
                    : 'Envío no habilitado; podés copiar el enlace.';
                // Every new context requires a new operator action; never inherit a checked box.
                if (($record[EdnaFormLink::CRM_FIELD] ?? '') !== $url
                    || ! in_array($record[EdnaFormLink::SEND_FIELD] ?? null, [0, '0', false, 'N'], true)
                    || ($record[EdnaFormLink::STATUS_FIELD] ?? '') !== $status) {
                    $api->call('crm.'.$context->crm_entity.'.update', ['id' => $context->crm_id,
                        'fields' => [EdnaFormLink::CRM_FIELD => $url, EdnaFormLink::SEND_FIELD => 0,
                            EdnaFormLink::STATUS_FIELD => $status]]);
                    $record = $api->call('crm.'.$context->crm_entity.'.get', ['id' => $context->crm_id]);
                    if (($record[EdnaFormLink::CRM_FIELD] ?? '') !== $url
                        || ! in_array($record[EdnaFormLink::SEND_FIELD] ?? null, [0, '0', false, 'N'], true)
                        || ($record[EdnaFormLink::STATUS_FIELD] ?? '') !== $status) {
                        throw new RuntimeException('CRM form link read-back did not match.');
                    }
                }
                $this->record(['crm_state' => 'synced', 'crm_reason' => null]);
            });
        } catch (Throwable) {
            throw new RuntimeException('CRM form link sync unconfirmed; inspect the entry event ID.');
        }
    }

    private function locked(): ?object
    {
        return DB::table('edna_form_links')->where('scope', $this->scope)
            ->where('entry_event_id', $this->entryEventId)->lockForUpdate()->first();
    }

    private function record(array $values): void
    {
        DB::table('edna_form_links')->where('scope', $this->scope)->where('entry_event_id', $this->entryEventId)
            ->update($values + ['updated_at' => now()]);
    }

    public function failed(?Throwable $exception): void
    {
        $this->record(['crm_state' => 'review', 'crm_reason' => 'sync_exhausted']);
    }
}
