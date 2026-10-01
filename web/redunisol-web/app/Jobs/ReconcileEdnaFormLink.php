<?php

namespace App\Jobs;

use App\Services\EdnaApi;
use App\Services\EdnaFormRequest;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class ReconcileEdnaFormLink implements ShouldQueue
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
            if ($send && in_array($send->state, ['confirmed', 'rejected'], true)) {
                (new EdnaFormRequest)->publishSend($send, $send->state);

                return;
            }
            if (! $send || ! in_array($send->state, ['sending', 'accepted', 'unknown'], true)) {
                return;
            }
            $phone = Crypt::decryptString($send->recipient);
            $response = (new EdnaApi)->post('messages/history', [
                'subscriberFilter' => ['address' => $phone, 'type' => 'PHONE'],
                'subjectId' => (int) $send->subject_id, 'direction' => 'OUT', 'channelTypes' => ['WHATSAPP'],
                'dateFrom' => CarbonImmutable::parse($send->send_started_at)->subMinute()->toIso8601String(),
                'dateTo' => CarbonImmutable::parse($send->send_started_at)->addHours(24)->toIso8601String(),
                'limit' => 1000, 'offset' => 0, 'sort' => [['property' => 'messageId', 'direction' => 'DESC']],
            ]);
            if ($response->status() !== 200 || ! is_array($response->json('content')) || $response->json('hasNext') !== false) {
                throw new RuntimeException('Incomplete Edna history.');
            }
            $expected = json_decode($send->content, true, 32, JSON_THROW_ON_ERROR);
            $matches = [];
            foreach ($response->json('content') as $message) {
                if (($message['comment'] ?? null) !== $send->request_id) {
                    continue;
                }
                $content = $message['content'] ?? null;
                $content = is_string($content) ? json_decode($content, true) : $content;
                if (($message['direction'] ?? '') !== 'OUT' || ($message['channelType'] ?? '') !== 'WHATSAPP'
                    || (string) ($message['subjectId'] ?? '') !== $send->subject_id
                    || (string) ($message['cascadeId'] ?? '') !== $send->cascade_id
                    || ($message['address'] ?? '') !== $phone || ($content['type'] ?? '') !== 'TEXT'
                    || ($content['text'] ?? '') !== $expected['text']
                    || ! preg_match('/^[0-9]{1,64}$/D', (string) ($message['messageId'] ?? ''))) {
                    throw new RuntimeException('History does not match the recorded send.');
                }
                $matches[(string) $message['messageId']] = $message;
            }
            if (count($matches) !== 1) {
                throw new RuntimeException('History is missing or ambiguous.');
            }
            $message = array_values($matches)[0];
            if (in_array($message['deliveryStatus'] ?? '', ['INVALID', 'FAILED', 'UNDELIVERED', 'CANCELLED'], true)) {
                $state = 'rejected';
            } elseif (in_array($message['deliveryStatus'] ?? '', ['SENT', 'DELIVERED', 'READ'], true)) {
                $state = 'confirmed';
            } else {
                throw new RuntimeException('Message is not yet sent.');
            }
            DB::table('edna_form_link_sends')->where('id', $send->id)->whereIn('state', ['sending', 'accepted', 'unknown'])
                ->update(['state' => $state, 'reason' => null, 'outgoing_message_id' => (string) $message['messageId'], 'updated_at' => now()]);
            (new EdnaFormRequest)->publishSend($send, $state);
        } catch (Throwable) {
            throw new RuntimeException('Form link history unconfirmed; inspect the send ID.');
        }
    }

    public function failed(?Throwable $exception): void
    {
        DB::table('edna_form_link_sends')->where('id', $this->sendId)->whereIn('state', ['sending', 'accepted', 'unknown'])
            ->update(['state' => 'unknown', 'reason' => 'history_exhausted', 'updated_at' => now()]);
    }
}
