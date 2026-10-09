<?php

namespace App\Jobs;

use App\Models\EdnaOutOfHoursSend;
use App\Services\EdnaApi;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use RuntimeException;
use Throwable;

class ReconcileEdnaOutOfHours implements ShouldQueue
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
            $send = EdnaOutOfHoursSend::find($this->sendId);
            if (! $send || ! in_array($send->state, ['sending', 'accepted', 'unknown'], true)) {
                return;
            }
            $response = (new EdnaApi)->post('messages/history', [
                'subscriberFilter' => ['address' => $send->recipient, 'type' => 'PHONE'],
                'subjectId' => (int) $send->subject_id, 'direction' => 'OUT', 'channelTypes' => ['WHATSAPP'],
                'dateFrom' => $send->send_started_at->subMinute()->toIso8601String(),
                'dateTo' => $send->send_started_at->addHours(24)->toIso8601String(),
                'limit' => 1000, 'offset' => 0, 'sort' => [['property' => 'messageId', 'direction' => 'DESC']],
            ]);
            if ($response->status() !== 200 || ! is_array($response->json('content')) || $response->json('hasNext') !== false) {
                throw new RuntimeException('Incomplete outgoing history.');
            }
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
                    || ($message['address'] ?? '') !== $send->recipient || ($content['type'] ?? '') !== 'TEXT'
                    || ($content['text'] ?? '') !== $send->message_text
                    || ! preg_match('/^[0-9]{1,64}$/D', (string) ($message['messageId'] ?? ''))) {
                    throw new RuntimeException('Outgoing history does not match the recorded notice.');
                }
                $matches[(string) $message['messageId']] = $message;
            }
            if (count($matches) !== 1) {
                throw new RuntimeException('Outgoing notice is missing or ambiguous.');
            }
            $message = array_values($matches)[0];
            if (in_array($message['deliveryStatus'] ?? '', ['INVALID', 'FAILED', 'UNDELIVERED', 'CANCELLED'], true)) {
                $state = 'rejected';
                $reason = 'outgoing_not_delivered';
            } elseif (in_array($message['deliveryStatus'] ?? '', ['SENT', 'DELIVERED', 'READ'], true)) {
                $state = 'confirmed';
                $reason = null;
            } else {
                throw new RuntimeException('Outgoing notice is not yet sent.');
            }
            EdnaOutOfHoursSend::whereKey($send->id)->whereIn('state', ['sending', 'accepted', 'unknown'])->update([
                'state' => $state, 'reason' => $reason, 'outgoing_message_id' => (string) $message['messageId'], 'updated_at' => now(),
            ]);
        } catch (Throwable) {
            throw new RuntimeException('Out of hours history unconfirmed; inspect the send ID.');
        }
    }

    public function failed(?Throwable $exception): void
    {
        EdnaOutOfHoursSend::whereKey($this->sendId)->whereIn('state', ['sending', 'accepted', 'unknown'])->update([
            'state' => 'unknown', 'reason' => 'history_exhausted', 'updated_at' => now(),
        ]);
    }
}
