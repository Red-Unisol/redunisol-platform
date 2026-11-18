<?php

namespace App\Services;

use App\Jobs\RouteEdnaIntakeChat;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Throwable;

/** A real completed V3 response for an existing native identity, using the existing profile contract. */
class EdnaNativeIntake
{
    public function process(object $request, object $send, array $proof): void
    {
        if ($request->state !== 'pending' || ! app(EdnaFreshIntake::class)->applies($send) || ($proof['version'] ?? null) !== 2
            || $send->state !== 'completed' || (int) $send->response_event_id !== (int) $request->response_event_id
            || ! config('edna.enabled') || ! config('edna.intake_crm_enabled')) {
            return;
        }
        $url = (string) config('edna.intake_processing_url');
        if (parse_url($url, PHP_URL_SCHEME) !== 'https'
            || ! str_contains((string) parse_url($url, PHP_URL_PATH), '/bitrix24_whatsapp_intake/')) {
            return;
        }
        $claimed = false;
        try {
            $attention = app(EdnaOrganicAttention::class)->inspectWelcome($proof);
            if (($attention['status'] ?? '') !== 'ready') {
                DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'pending')->update([
                    'state' => 'review', 'reason' => $attention['reason'] ?? 'native_attention_unavailable', 'updated_at' => now(),
                ]);

                return;
            }
            $service = new EdnaIntake;
            $attribution = $service->attribution($send);
            $context = $service->entryContext($send);
            if (! $attribution || ! $context) {
                throw new RuntimeException('Fresh intake context unavailable.');
            }
            unset($attribution['wa']['WA_FLOW_ID']);
            $attribution['wa']['WA_FLOW'] = 'organic_profile_reuse';
            $answer = json_decode(Crypt::decryptString($request->answer), true, 16, JSON_THROW_ON_ERROR);
            $body = ['contract' => EdnaOrganicLoan::CONTRACT, 'case_id' => $send->request_id,
                'phone' => Crypt::decryptString($send->recipient), 'dry_run' => false,
                'received_at' => CarbonImmutable::parse($request->received_at)->toIso8601String(), 'answer' => $answer,
                'entry_context' => $context, 'crm_binding' => array_replace($proof, ['version' => 1]), 'attribution' => $attribution,
                'provenance' => ['source_kind' => 'edna_intake_request', 'source_id' => (string) $request->id,
                    'schema' => 'whatsapp-intake-v3', 'v3_equivalent' => true,
                    'confirmed_at' => CarbonImmutable::parse($request->received_at)->toIso8601String()]];
            $entry = DB::table('edna_incoming_events')->find($send->entry_event_id);
            if ($entry && app(WebChatContinuity::class)->eligibleEntry($entry)) {
                $body['routing_policy'] = WebChatContinuity::NAME;
            }
            // This contract revalidates native message, CUIL and existing management in Kestra.
            // The actual Flow transport remains in edna_flow_sends and is never invented/replayed.
            $claimed = (bool) DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'pending')
                ->update(['state' => 'processing', 'updated_at' => now()]);
            if (! $claimed) {
                return;
            }
            $response = Http::asJson()->acceptJson()->connectTimeout(3)->timeout(60)->withoutRedirecting()->post($url, $body);
            $result = $response->json();
            if (! $response->successful() || ! is_array($result) || ($result['ok'] ?? null) !== true
                || ($result['contract'] ?? '') !== EdnaOrganicLoan::CONTRACT || ($result['case_id'] ?? '') !== $send->request_id
                || ! is_bool($result['write_attempted'] ?? null)) {
                throw new RuntimeException('Fresh intake acknowledgement uncertain.');
            }
            $action = $result['action'] ?? '';
            $assigned = $action === 'assigned_case' && $result['write_attempted'] === false;
            if ($assigned) {
                foreach (['deal_id', 'seller_id', 'contact_id'] as $key) {
                    if (! preg_match('/^[1-9][0-9]{0,18}$/D', (string) ($result[$key] ?? ''))) {
                        throw new RuntimeException('Assigned case acknowledgement invalid.');
                    }
                }
            }
            $synced = $assigned || in_array($action, ['queued', 'already_processed', 'rejected'], true);
            if ($synced && ! $assigned && ! preg_match('/^[1-9][0-9]{0,18}$/D', (string) ($result['lead_id'] ?? ''))) {
                throw new RuntimeException('Fresh intake CRM acknowledgement invalid.');
            }
            DB::transaction(function () use ($request, $proof, $answer, $result, $assigned, $synced): void {
                DB::table('edna_intake_requests')->where('id', $request->id)->where('state', 'processing')->update([
                    'state' => $synced ? 'synced' : 'review', 'reason' => $result['reason'] ?? 'native_intake_review',
                    'lead_id' => ($result['lead_id'] ?? null) ?: null, 'contact_id' => ($result['contact_id'] ?? null) ?: null, 'updated_at' => now(),
                ]);
                if ($assigned) {
                    $case = array_intersect_key($result, array_flip(['lead_id', 'contact_id', 'deal_id', 'seller_id']));
                    $case['identity_hash'] = (new WebFormReceipt)->identityHash($answer['cuil'] ?? '');
                    if (! $case['identity_hash']) {
                        throw new RuntimeException('Assigned case identity unavailable.');
                    }
                    if (DB::table('edna_intake_chat_routes')->insertOrIgnore([
                        'request_id' => $request->id, 'proof' => json_encode($proof, JSON_THROW_ON_ERROR),
                        'assigned_case' => json_encode($case, JSON_THROW_ON_ERROR), 'state' => 'pending',
                        'created_at' => now(), 'updated_at' => now(),
                    ])) {
                        Queue::connection('edna')->push(new RouteEdnaIntakeChat((int) $request->id), '', 'edna');
                    }
                }
            });
            if ($synced) {
                try {
                    app(EdnaOrganicProfile::class)->record('edna_intake_request', (string) $request->id, $body['phone'],
                        $answer, $request->received_at, ($result['lead_id'] ?? null) ?: null, ($result['contact_id'] ?? null) ?: null);
                } catch (Throwable) {
                    // Profile retention never replays an acknowledged application request.
                }
            }
        } catch (Throwable) {
            DB::table('edna_intake_requests')->where('id', $request->id)->whereIn('state', ['pending', 'processing'])->update([
                'state' => $claimed ? 'unknown' : 'review',
                'reason' => $claimed ? 'crm_acknowledgement_uncertain' : 'native_intake_preflight_unavailable', 'updated_at' => now(),
            ]);
        }
    }
}
