<?php

namespace App\Jobs;

use App\Services\AttributionJourney;
use App\Services\EdnaApi;
use App\Services\EdnaBitrix;
use App\Services\EdnaFormLink;
use App\Services\EdnaFormRequest;
use App\Services\EdnaFormTemplate;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Throwable;

class SendEdnaFormLink implements ShouldQueue
{
    use Queueable;

    public int $tries = 8;

    public int $timeout = 40;

    public function __construct(public readonly int $sendId) {}

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300, 600, 1800];
    }

    public function handle(): void
    {
        try {
            $send = DB::table('edna_form_link_sends')->find($this->sendId);
            if (! $send || in_array($send->state, ['confirmed', 'rejected', 'cancelled'], true)) {
                return;
            }
            if ($send->state !== 'pending') {
                Queue::connection('edna')->push(new ReconcileEdnaFormLink($send->id), '', 'edna');

                return;
            }
            if (! config('edna.enabled') || ! config('edna.form_links_enabled') || ! config('edna.form_link_send_enabled')
                || $send->subject_id !== (string) config('edna.subject_id') || ! $send->recipient) {
                $this->cancel();

                return;
            }
            $phone = Crypt::decryptString($send->recipient);
            if (! (new EdnaFormLink)->canSendTo($phone)) {
                $this->cancel();

                return;
            }
            $api = new EdnaApi;
            $api->assertCascade($send);
            $template = new EdnaFormTemplate;
            if (($template->inspect()['status'] ?? '') !== 'APPROVED') {
                throw new RuntimeException('The dynamic template is not approved.');
            }
            $content = DB::transaction(function () use ($send, $phone, $template): ?array {
                $context = DB::table('edna_form_links')->where('scope', $send->scope)->lockForUpdate()->first();
                if (! $context || (int) $context->entry_event_id !== (int) $send->entry_event_id
                    || $context->crm_entity !== $send->crm_entity || $context->crm_id !== $send->crm_id
                    || CarbonImmutable::parse($context->entry_received_at)->lte(now()->subHours(23))) {
                    $this->cancel();

                    return null;
                }
                $record = (new EdnaBitrix)->call('crm.'.$send->crm_entity.'.get', ['id' => $send->crm_id]);
                $journeys = new AttributionJourney;
                $hash = $journeys->phoneHash($phone);
                $validPhone = collect($record['PHONE'] ?? [])->contains(fn ($p) => $hash
                    && $journeys->phoneHash((string) ($p['VALUE'] ?? '')) === $hash);
                if ((string) ($record['ID'] ?? '') !== $send->crm_id || ! $validPhone
                    || ! in_array($record[EdnaFormLink::SEND_FIELD] ?? null, [true, 1, '1', 'Y'], true)
                    || ($send->crm_entity === 'lead' && ($record['STATUS_SEMANTIC_ID'] ?? '') !== 'P')) {
                    $this->cancel();

                    return null;
                }
                $ref = (new EdnaFormLink)->reference($context);
                $content = $template->content($ref);
                $claimed = DB::table('edna_form_link_sends')->where('id', $send->id)->where('state', 'pending')->update([
                    'state' => 'sending', 'send_started_at' => now(), 'journey_id' => $ref,
                    'content' => json_encode($content, JSON_THROW_ON_ERROR), 'updated_at' => now(),
                ]);

                return $claimed ? $content : null;
            });
            if (! $content) {
                return;
            }
            // The claim is committed before the external side effect. Never retry this POST.
            $state = 'unknown';
            $reason = 'schedule_uncertain';
            try {
                $response = $api->post('cascade/schedule', ['requestId' => $send->request_id,
                    'comment' => $send->request_id, 'cascadeId' => $send->cascade_id,
                    'subscriberFilter' => ['address' => $phone, 'type' => 'PHONE'],
                    'content' => ['whatsappContent' => $content]]);
                if ($response->status() === 200 && $response->json('requestId') === $send->request_id) {
                    $state = 'accepted';
                    $reason = null;
                } elseif ($response->clientError() && ! in_array($response->status(), [408, 429], true)) {
                    $state = 'rejected';
                    $reason = 'schedule_http_'.$response->status();
                }
            } catch (Throwable) {
                // A timeout may already have sent the message. Only read history from here on.
            }
            DB::transaction(function () use ($send, $state, $reason): void {
                DB::table('edna_form_link_sends')->where('id', $send->id)->where('state', 'sending')
                    ->update(['state' => $state, 'reason' => $reason, 'updated_at' => now()]);
                if ($state !== 'rejected') {
                    Queue::connection('edna')->later(5, new ReconcileEdnaFormLink($send->id), '', 'edna');
                }
            });
            (new EdnaFormRequest)->publishSend($send, $state);
        } catch (Throwable) {
            throw new RuntimeException('Form link send unconfirmed; inspect the send ID.');
        }
    }

    private function cancel(): void
    {
        DB::table('edna_form_link_sends')->where('id', $this->sendId)->where('state', 'pending')
            ->update(['state' => 'cancelled', 'reason' => 'preflight_changed', 'updated_at' => now()]);
    }

    public function failed(?Throwable $exception): void
    {
        $this->cancel();
        DB::table('edna_form_link_sends')->where('id', $this->sendId)->where('state', 'sending')
            ->update(['state' => 'unknown', 'reason' => 'worker_interrupted', 'updated_at' => now()]);
    }
}
