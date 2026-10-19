<?php

namespace App\Jobs;

use App\Services\EdnaApi;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class ReconcileEdnaAssistance implements ShouldQueue
{
    use Queueable;

    public int $tries = 8;

    public int $timeout = 40;

    public function __construct(public readonly int $caseId, public readonly bool $landing = false) {}

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300, 600, 1800];
    }

    public function handle(): void
    {
        $prefix = $this->landing ? 'link_' : '';
        $key = $prefix.'state';
        try {
            $case = DB::table('edna_assistance_cases')->find($this->caseId);
            if (! $case || ! $case->recipient || ! in_array($case->$key, ['sending', 'accepted', 'unknown'], true)) {
                return;
            }
            $phone = Crypt::decryptString($case->recipient);
            $started = CarbonImmutable::parse($case->{$prefix.'send_started_at'});
            $response = (new EdnaApi)->post('messages/history', [
                'subscriberFilter' => ['address' => $phone, 'type' => 'PHONE'],
                'subjectId' => (int) $case->subject_id, 'direction' => 'OUT', 'channelTypes' => ['WHATSAPP'],
                'dateFrom' => $started->subMinute()->toIso8601String(), 'dateTo' => $started->addHours(24)->toIso8601String(),
                'limit' => 1000, 'offset' => 0, 'sort' => [['property' => 'messageId', 'direction' => 'DESC']],
            ]);
            if ($response->status() !== 200 || ! is_array($response->json('content')) || $response->json('hasNext') !== false) {
                throw new RuntimeException('Incomplete assistance history.');
            }
            $matches = [];
            foreach ($response->json('content') as $message) {
                if (($message['comment'] ?? null) !== $case->{$prefix.'request_id'}) {
                    continue;
                }
                $content = $message['content'] ?? null;
                $content = is_string($content) ? json_decode($content, true) : $content;
                $correctContent = $this->landing
                    ? ($content['type'] ?? '') === 'TEXT' && ($content['text'] ?? '') === Crypt::decryptString($case->link_text)
                    : ($content['type'] ?? '') === 'FLOW' && (string) ($content['flowId'] ?? '') === $case->flow_id;
                if (! $correctContent || ($message['direction'] ?? '') !== 'OUT' || ($message['channelType'] ?? '') !== 'WHATSAPP'
                    || (string) ($message['subjectId'] ?? '') !== $case->subject_id || (string) ($message['cascadeId'] ?? '') !== $case->cascade_id
                    || ($message['address'] ?? '') !== $phone || ! preg_match('/^[0-9]{1,64}$/D', (string) ($message['messageId'] ?? ''))) {
                    throw new RuntimeException('Assistance history mismatch.');
                }
                $matches[(string) $message['messageId']] = $message;
            }
            if (count($matches) !== 1) {
                throw new RuntimeException('Assistance history missing or ambiguous.');
            }
            $message = array_values($matches)[0];
            $status = $message['deliveryStatus'] ?? '';
            $state = in_array($status, ['SENT', 'DELIVERED', 'READ'], true) ? 'confirmed'
                : (in_array($status, ['INVALID', 'FAILED', 'UNDELIVERED', 'CANCELLED'], true) ? 'rejected' : null);
            if (! $state) {
                throw new RuntimeException('Assistance delivery not confirmed.');
            }
            DB::table('edna_assistance_cases')->where('id', $case->id)->whereIn($key, ['sending', 'accepted', 'unknown'])
                ->update([$key => $state, $prefix.'outgoing_message_id' => (string) $message['messageId'], 'updated_at' => now()]);
        } catch (Throwable) {
            throw new RuntimeException('Assistance history unconfirmed; inspect the case ID.');
        }
    }

    public function failed(?Throwable $exception): void
    {
        $key = $this->landing ? 'link_state' : 'state';
        DB::table('edna_assistance_cases')->where('id', $this->caseId)->whereIn($key, ['sending', 'accepted', 'unknown'])
            ->update([$key => 'unknown', 'reason' => 'history_exhausted', 'updated_at' => now()]);
    }
}
