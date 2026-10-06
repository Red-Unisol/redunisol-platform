<?php

namespace App\Services;

use App\Jobs\SendEdnaFormLink;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use RuntimeException;

class EdnaFormRequest
{
    public function poll(): int
    {
        if (! config('edna.form_links_enabled') || ! config('edna.form_link_send_enabled')) {
            return 0;
        }
        $api = new EdnaBitrix;
        $count = 0;
        $failed = false;
        foreach (['contact', 'lead'] as $entity) {
            if ((new EdnaFormLink)->schema($entity)) {
                throw new RuntimeException('CRM action schema is missing.');
            }
            // Bitrix returns one bounded page. Requests remain set until a result is acknowledged.
            $records = $api->call('crm.'.$entity.'.list', ['filter' => [EdnaFormLink::SEND_FIELD => 1],
                'select' => ['ID'], 'order' => ['ID' => 'ASC']]);
            foreach ($records as $record) {
                try {
                    $this->reserve($entity, (string) $record['ID']);
                    $count++;
                } catch (\Throwable) {
                    // One unavailable CRM record must not starve every other advisor request.
                    $failed = true;
                }
            }
        }
        if ($failed) {
            throw new RuntimeException('Some CRM form requests could not be acknowledged.');
        }

        return $count;
    }

    public function reserve(string $entity, string $id): void
    {
        if (! in_array($entity, ['contact', 'lead'], true) || ! ctype_digit($id)) {
            throw new RuntimeException('Invalid CRM action target.');
        }
        DB::transaction(function () use ($entity, $id): void {
            $status = $this->reservationStatus($entity, $id);
            if ($status) {
                // Hold the context lock through projection; a newer context must not inherit this result.
                $this->publish($entity, $id, $status, ! str_starts_with($status, 'Pendiente'));
            }
        });
    }

    private function reservationStatus(string $entity, string $id): ?string
    {
        // No recovery by telephone, historic CRM JOURNEY_ID or arbitrary active lead.
        $contexts = DB::table('edna_form_links')->where('crm_entity', $entity)->where('crm_id', $id)
            ->where('subject_id', (string) config('edna.subject_id'))->lockForUpdate()->get();
        if ($contexts->count() !== 1 || $contexts[0]->crm_state !== 'synced') {
            return 'No enviado: conversación no identificada. Revisar la ficha.';
        }
        $context = $contexts[0];
        if (CarbonImmutable::parse($context->entry_received_at)->lte(now()->subHours(23))) {
            return 'No enviado: conversación vencida. Esperar un nuevo mensaje.';
        }
        $send = DB::table('edna_form_link_sends')->where('entry_event_id', $context->entry_event_id)->first();
        if ($send) {
            return self::status($send->state);
        }
        if (! config('edna.form_link_send_enabled') || ! config('edna.form_links_enabled')) {
            return null;
        }
        if (! (new EdnaFormLink)->canSendTo(Crypt::decryptString($context->recipient))) {
            return 'Envío no habilitado; podés copiar el enlace.';
        }
        $sendId = DB::table('edna_form_link_sends')->insertGetId([
            'entry_event_id' => $context->entry_event_id, 'scope' => $context->scope,
            'request_id' => (string) Str::uuid(), 'subject_id' => $context->subject_id,
            'cascade_id' => (string) config('edna.cascade_id'), 'recipient' => $context->recipient,
            'crm_entity' => $entity, 'crm_id' => $id, 'created_at' => now(), 'updated_at' => now(),
        ]);
        Queue::connection('edna')->push(new SendEdnaFormLink($sendId), '', 'edna');

        return null;
    }

    public function publish(string $entity, string $id, string $status, bool $clear = true): void
    {
        (new EdnaBitrix)->call('crm.'.$entity.'.update', ['id' => $id, 'fields' => [
            EdnaFormLink::STATUS_FIELD => $status,
            ...($clear ? [EdnaFormLink::SEND_FIELD => 0] : []),
        ]]);
    }

    public function publishSend(object $send, string $state): void
    {
        DB::transaction(function () use ($send, $state): void {
            $context = DB::table('edna_form_links')->where('scope', $send->scope)->lockForUpdate()->first();
            if ($context && (int) $context->entry_event_id === (int) $send->entry_event_id) {
                $currentState = DB::table('edna_form_link_sends')->where('id', $send->id)->value('state');
                $this->publish($send->crm_entity, $send->crm_id, self::status($currentState ?? $state));
            }
        });
    }

    public static function status(string $state): string
    {
        return match ($state) {
            'pending' => 'Pendiente de envío.',
            'sending', 'unknown' => 'Revisar: resultado incierto. No reenviar.',
            'accepted' => 'Aceptado por Edna. Pendiente de confirmar entrega.',
            'confirmed' => 'Enviado por WhatsApp.',
            'rejected' => 'No entregado por Edna. Revisar el envío.',
            default => 'No enviado: conversación o configuración cambió. Revisar.',
        };
    }
}
