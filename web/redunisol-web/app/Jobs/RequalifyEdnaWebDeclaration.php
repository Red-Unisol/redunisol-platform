<?php

namespace App\Jobs;

use App\Services\AttributionJourney;
use App\Services\WebFormReceipt;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Throwable;

/** Records a read-only prequalification for a new declaration on a proven web request. */
class RequalifyEdnaWebDeclaration implements ShouldQueue
{
    use Queueable;

    private const CONTRACT = 'web-v3-prequalification-v1';

    public int $tries = 8;

    public int $timeout = 85;

    public function __construct(public readonly int $requestId) {}

    public function backoff(): array
    {
        return [15, 45, 120, 300, 900, 1800, 3600];
    }

    public function handle(): void
    {
        $request = DB::table('edna_intake_requests')->find($this->requestId);
        if (! $request || $request->state !== 'pending_requalification' || $request->web_prequalification !== null) {
            return;
        }
        $send = DB::table('edna_flow_sends')->find($request->flow_send_id);
        if (! $send || $send->state !== 'completed' || (int) $send->response_event_id !== (int) $request->response_event_id) {
            throw new RuntimeException('The completed Flow receipt could not be matched.');
        }
        $answer = json_decode(Crypt::decryptString($request->answer), true, 16, JSON_THROW_ON_ERROR);
        $province = $answer['provincia'] ?? '';
        $province = is_string($province) && preg_match('/^[a-z_]{1,24}$/D', $province) ? $province : '';
        $fields = [];
        foreach (['provincia', 'situacion_'.$province, 'organismo', 'organismo_'.$province, 'banco_jubilado', 'banco_'.$province] as $key) {
            $value = $answer[$key] ?? null;
            if (is_string($value) && preg_match('/^[a-z_]{1,64}$/D', $value)) {
                $fields[$key] = $value;
            }
        }
        ksort($fields);
        $digest = hash('sha256', json_encode((object) $fields, JSON_THROW_ON_ERROR));
        $body = ['contract' => self::CONTRACT, 'case_id' => $send->request_id, 'web_submission_id' => $request->web_submission_id,
            'received_at' => CarbonImmutable::parse($request->received_at)->toIso8601String(),
            'flow_id' => $send->flow_id, 'fields' => (object) $fields, 'input_digest' => $digest];
        $url = (string) config('edna.intake_processing_url');
        if (parse_url($url, PHP_URL_SCHEME) !== 'https' || ! parse_url($url, PHP_URL_HOST)
            || ! str_contains((string) parse_url($url, PHP_URL_PATH), '/bitrix24_whatsapp_intake/')) {
            throw new RuntimeException('The precalification endpoint is unavailable.');
        }
        try {
            $response = Http::asJson()->acceptJson()->withoutRedirecting()->connectTimeout(3)->timeout(60)->post($url, $body);
        } catch (Throwable) {
            throw new RuntimeException('Could not obtain the read-only precalification.');
        }
        $result = $response->json();
        if (! $response->successful() || ! is_array($result) || ($result['ok'] ?? null) !== true
            || ($result['write_attempted'] ?? null) !== false || ($result['contract'] ?? null) !== self::CONTRACT
            || ($result['case_id'] ?? null) !== $send->request_id || ($result['web_submission_id'] ?? null) !== $request->web_submission_id
            || ($result['input_digest'] ?? null) !== $digest || ! in_array($result['action'] ?? null, ['qualified', 'rejected', 'external_referral', 'pending'], true)
            || ! is_string($result['reason'] ?? null) || ! preg_match('/^[a-z0-9_]{1,80}$/D', $result['reason'])
            || ! is_string($result['rule_version'] ?? null) || ! preg_match('/^[A-Za-z0-9_.-]{1,100}$/D', $result['rule_version'])) {
            throw new RuntimeException('Invalid precalification acknowledgement.');
        }
        $identity = (new WebFormReceipt)->identityHash((string) ($answer['cuil'] ?? ''));
        $phone = $send->recipient ? (new AttributionJourney)->phoneHash(Crypt::decryptString($send->recipient)) : null;
        DB::transaction(function () use ($request, $result, $body, $identity, $phone): void {
            $receipt = DB::table('web_form_receipts')->where('id', $request->web_submission_id)->lockForUpdate()->first();
            $current = DB::table('edna_intake_requests')->where('id', $request->id)->lockForUpdate()->first();
            if (! $current || $current->state !== 'pending_requalification' || $current->web_prequalification !== null) {
                return;
            }
            if ($request->answer !== $current->answer || $request->web_submission_id !== $current->web_submission_id
                || $request->lead_id !== $current->lead_id || $request->response_event_id !== $current->response_event_id) {
                throw new RuntimeException('Declaration changed before precalification was recorded.');
            }
            $same = $receipt && $receipt->state === 'synced' && $receipt->source === 'web_server'
                && $receipt->lead_id === $current->lead_id && $receipt->contact_id === $current->contact_id
                && $identity && hash_equals((string) $receipt->identity_hash, $identity)
                && $phone && hash_equals((string) $receipt->phone_hash, $phone);
            $decision = ['scope' => 'declared_data_prequalification', 'outcome' => $result['action'],
                'reason' => $result['reason'], 'rule_version' => $result['rule_version'],
                'received_at' => $body['received_at'], 'evaluated_at' => now()->toIso8601String(),
                'input_digest' => $body['input_digest'], 'applies_to_web_request' => (bool) $same,
                'credit_checks' => 'not_evaluated', 'crm_action' => 'none'];
            DB::table('edna_intake_requests')->where('id', $current->id)->update([
                'state' => 'synced', 'reason' => $same ? 'fresh_web_prequalification' : 'fresh_web_link_changed',
                'web_prequalification' => json_encode($decision, JSON_THROW_ON_ERROR), 'updated_at' => now(),
            ]);
        });
    }

    public function failed(?Throwable $exception): void
    {
        // The source is durable and a queue retry may safely recompute it.
        DB::table('edna_intake_requests')->where('id', $this->requestId)->where('state', 'pending_requalification')
            ->whereNull('web_prequalification')->update(['reason' => 'fresh_prequalification_unavailable', 'updated_at' => now()]);
    }
}
