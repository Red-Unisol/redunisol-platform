<?php

namespace App\Jobs;

use App\Services\EdnaApi;
use App\Services\EdnaFlowTransport;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class ReconcileEdnaFlow implements ShouldQueue
{
    use Queueable;
    use \App\Jobs\Middleware\TracksJourney;

    public int $tries = 8;

    public int $timeout = 40;

    // Missing aliases in older serialized jobs belong to the original attempt.
    public ?string $transportRequestId = null;

    public function __construct(public readonly int $sendId, ?string $transportRequestId = null)
    {
        $this->transportRequestId = $transportRequestId;
    }

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300, 600, 1800];
    }

    public function handle(): void
    {
        try {
            $send = DB::table('edna_flow_sends')->where('id', $this->sendId)->first();
            $transport = app(EdnaFlowTransport::class);
            if (! $send || ! $transport->matches($send, $this->transportRequestId)
                || ! in_array($send->state, ['sending', 'accepted', 'unknown'], true)) {
                return;
            }
            $transportId = $transport->id($send);
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
            $matches = [];
            foreach ($response->json('content') as $message) {
                if (($message['comment'] ?? null) !== $transportId) {
                    continue;
                }
                if (($message['direction'] ?? '') !== 'OUT' || ($message['channelType'] ?? '') !== 'WHATSAPP'
                    || (string) ($message['subjectId'] ?? '') !== $send->subject_id
                    || (string) ($message['cascadeId'] ?? '') !== $send->cascade_id
                    || ($message['address'] ?? '') !== $phone
                    || (! is_int($message['messageId'] ?? null) && ! is_string($message['messageId'] ?? null))
                    || ! preg_match('/^[0-9]{1,64}$/D', (string) ($message['messageId'] ?? ''))
                    || ($send->outgoing_message_id !== null && $send->outgoing_message_id !== (string) $message['messageId'])) {
                    throw new RuntimeException('Edna history does not match the recorded send.');
                }
                if (isset($matches[(string) $message['messageId']]) && $matches[(string) $message['messageId']] !== $message) {
                    throw new RuntimeException('Edna history contains conflicting message records.');
                }
                $matches[(string) $message['messageId']] = $message;
            }
            if (count($matches) !== 1) {
                throw new RuntimeException('Edna history is missing or ambiguous.');
            }
            $message = array_values($matches)[0];
            if (in_array($message['deliveryStatus'] ?? '', ['INVALID', 'FAILED', 'UNDELIVERED', 'CANCELLED'], true)) {
                // Provider rejection can omit the Flow body. The exact send identity
                // above proves this failed attempt without implying delivery.
                $state = 'rejected';
                $reason = 'outgoing_not_delivered';
            } elseif (in_array($message['deliveryStatus'] ?? '', ['SENT', 'DELIVERED', 'READ'], true)) {
                $content = $message['content'] ?? null;
                $content = is_string($content) ? json_decode($content, true) : $content;
                if (! is_array($content) || ($content['type'] ?? '') !== 'FLOW'
                    || (string) ($content['flowId'] ?? '') !== $send->flow_id) {
                    throw new RuntimeException('Edna history does not match the recorded Flow.');
                }
                $state = 'confirmed';
                $reason = null;
            } else {
                throw new RuntimeException('Edna message is not yet sent.');
            }
            $transport->update($send, ['sending', 'accepted', 'unknown'], [
                'state' => $state, 'reason' => $reason, 'outgoing_message_id' => (string) $message['messageId'], 'updated_at' => now(),
            ]);
        } catch (Throwable) {
            throw new RuntimeException('Edna Flow history unconfirmed; inspect the send ID.');
        }
    }

    public function failed(?Throwable $exception): void
    {
        $send = DB::table('edna_flow_sends')->where('id', $this->sendId)->first();
        $transport = app(EdnaFlowTransport::class);
        if (! $send || ! $transport->matches($send, $this->transportRequestId)) {
            return;
        }
        $transport->update($send, ['sending', 'accepted', 'unknown'], [
            'state' => 'unknown', 'reason' => 'history_exhausted', 'updated_at' => now(),
        ]);
    }
}
