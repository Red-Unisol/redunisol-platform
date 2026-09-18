<?php

namespace App\Http\Controllers;

use App\Jobs\ReceiveEdnaInKestra;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use JsonException;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class EdnaIncomingController extends Controller
{
    public function __invoke(Request $request): Response
    {
        $key = (string) config('edna.webhook_key');
        $subjectId = (string) config('edna.subject_id');
        $url = (string) config('edna.kestra_url');
        if (! config('edna.enabled') || $key === '' || ! preg_match('/^[0-9]{1,64}$/D', $subjectId)
            || parse_url($url, PHP_URL_SCHEME) !== 'https' || ! parse_url($url, PHP_URL_HOST)) {
            return response()->json(['code' => 'not_configured'], 503);
        }

        // Edna verifies the URL using an unauthenticated HEAD; it never ingests data.
        if ($request->isMethod('HEAD')) {
            return response('', 200);
        }
        if (! hash_equals($key, (string) $request->header((string) config('edna.auth_header')))) {
            return response()->json(['code' => 'unauthorized'], 401);
        }
        if (! $request->isJson()) {
            return response()->json(['code' => 'expected_json'], 415);
        }
        if (strlen($request->getContent()) > 1048576) {
            return response()->json(['code' => 'payload_too_large'], 413);
        }
        try {
            $batch = json_decode($request->getContent(), true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return response()->json(['code' => 'invalid_json'], 400);
        }
        // Edna documents single objects for TEXT and arrays for FLOW callbacks.
        $firstCharacter = substr(ltrim($request->getContent()), 0, 1);
        if ($firstCharacter === '{' && is_array($batch) && array_key_exists('id', $batch)) {
            $batch = [$batch];
        } elseif ($firstCharacter !== '[') {
            return response()->json(['code' => 'invalid_batch'], 400);
        }
        if (! is_array($batch)
            || ! array_is_list($batch) || count($batch) > 100) {
            return response()->json(['code' => 'invalid_batch'], 400);
        }

        try {
            $counts = DB::transaction(function () use ($batch, $subjectId): array {
                $counts = ['accepted' => 0, 'duplicates' => 0, 'ignored' => 0, 'invalid' => 0];
                foreach ($batch as $event) {
                    if (! is_array($event) || ! $this->validId($event['subjectId'] ?? null)) {
                        $counts['invalid']++;

                        continue;
                    }
                    if ((string) $event['subjectId'] !== $subjectId) {
                        $counts['ignored']++;

                        continue;
                    }
                    if (! $this->validId($event['id'] ?? null)) {
                        $counts['invalid']++;

                        continue;
                    }
                    $content = $event['messageContent'] ?? null;
                    if (! is_array($content) || ! is_string($content['type'] ?? null)) {
                        $counts['invalid']++;

                        continue;
                    }
                    if (! in_array($content['type'], ['TEXT', 'FLOW'], true)) {
                        $counts['ignored']++;

                        continue;
                    }
                    $subscriber = $event['subscriber'] ?? null;
                    if (! is_array($subscriber) || ! is_string($subscriber['identifier'] ?? null)
                        || $subscriber['identifier'] === '' || strlen($subscriber['identifier']) > 128
                        || ! is_string($content['text'] ?? null) || strlen($content['text']) > 32768
                        || ! is_string($event['receivedAt'] ?? null) || strlen($event['receivedAt']) > 64) {
                        $counts['invalid']++;

                        continue;
                    }
                    $payload = [
                        'id' => (string) $event['id'],
                        'subjectId' => $subjectId,
                        'subscriber' => ['identifier' => $subscriber['identifier']],
                        'receivedAt' => $event['receivedAt'],
                        'messageContent' => ['type' => $content['type'], 'text' => $content['text']],
                    ];
                    // Edna links FLOW replies to the outgoing message and our requestId.
                    // Keep these references for correlation; they are not proof of a Flow ID.
                    $replyId = $event['replyOutMessageId'] ?? null;
                    $replyRequest = $event['replyOutMessageExternalRequestId'] ?? null;
                    if (($replyId !== null && ! $this->validId($replyId))
                        || ($replyRequest !== null && (! is_string($replyRequest)
                            || $replyRequest === '' || strlen($replyRequest) > 256))) {
                        $counts['invalid']++;

                        continue;
                    }
                    if ($replyId !== null) {
                        $payload['replyOutMessageId'] = (string) $replyId;
                    }
                    if ($replyRequest !== null) {
                        $payload['replyOutMessageExternalRequestId'] = $replyRequest;
                    }
                    $inserted = DB::table('edna_incoming_events')->insertOrIgnore([
                        'subject_id' => $subjectId,
                        'message_id' => $payload['id'],
                        'payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR)),
                        'status' => 'pending',
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                    if (! $inserted) {
                        $counts['duplicates']++;

                        continue;
                    }
                    $id = DB::table('edna_incoming_events')
                        ->where('subject_id', $subjectId)->where('message_id', $payload['id'])->value('id');
                    // Same database connection and transaction as the inbox: either both commit or neither.
                    Queue::connection('edna')->push(new ReceiveEdnaInKestra((int) $id), '', 'edna');
                    $counts['accepted']++;
                }

                return $counts;
            });
        } catch (Throwable) {
            // Never expose database bindings, message text, keys or callback URLs in exception logs.
            return response()->json(['code' => 'temporarily_unavailable'], 503);
        }

        return response()->json(['code' => 'ok', ...$counts]);
    }

    private function validId(mixed $value): bool
    {
        return (is_int($value) || is_string($value)) && preg_match('/^[0-9]{1,64}$/D', (string) $value);
    }
}
