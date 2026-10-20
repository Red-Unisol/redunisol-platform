<?php

namespace App\Services;

use App\Jobs\ProcessEdnaAssistance;
use App\Jobs\SendEdnaAssistance;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class EdnaAssistance
{
    public const FLOW_ID = '1993586314642842';

    public function recordForm(string $phone): void
    {
        if (! config('edna.assistance_enabled') || ! config('edna.assistance_recipients')) {
            return;
        }
        $hash = (new AttributionJourney)->phoneHash($phone);
        foreach (config('edna.assistance_recipients') as $pilot) {
            if ($hash && $this->allowed($pilot) && hash_equals($hash, (new AttributionJourney)->phoneHash($pilot))) {
                DB::transaction(function () use ($hash, $pilot) {
                    DB::table('edna_assistance_form_receipts')->insert(['phone_hash' => $hash, 'submitted_at' => now()]);
                    $scope = (new EdnaFlowRouter)->scope((string) config('edna.subject_id'), $pilot);
                    DB::table('edna_assistance_cases')->where('scope', $scope)->where('state', 'waiting')
                        ->update(['state' => 'suppressed', 'reason' => 'form_queued_or_submitted', 'updated_at' => now()]);
                });

                return;
            }
        }
    }

    public function hasQueuedForm(string $phone): bool
    {
        return DB::table('edna_assistance_form_receipts')->where('phone_hash', (new AttributionJourney)->phoneHash($phone))
            ->where('submitted_at', '>=', now()->subDays(30))->exists();
    }

    public function allowed(string $phone): bool
    {
        $pilot = config('edna.assistance_recipients', []);

        return config('edna.enabled') && config('edna.assistance_enabled') && $pilot
            && in_array($phone, $pilot, true) && preg_match('/^[0-9]{10,15}$/D', $phone)
            && (new AttributionJourney)->phoneHash($phone) !== null;
    }

    public function poll(bool $dispatch = false): array
    {
        if (! config('edna.assistance_enabled') || ! config('edna.assistance_recipients') || ! config('edna.assistance_start_at')) {
            return ['enabled' => false, 'candidates' => 0, 'reserved' => 0];
        }
        $start = CarbonImmutable::parse(config('edna.assistance_start_at'));
        $scopes = array_map(fn ($phone) => (new EdnaFlowRouter)->scope((string) config('edna.subject_id'), $phone), config('edna.assistance_recipients'));
        $rows = DB::table('edna_router_results as r')->join('edna_flow_sends as s', 's.id', '=', 'r.flow_send_id')
            ->where('s.flow_id', EdnaFlowRouter::FLOW_ID)
            ->where('s.subject_id', (string) config('edna.subject_id'))->whereIn('s.scope', $scopes)
            ->whereNotExists(function ($q) {
                $q->selectRaw('1')->from('edna_assistance_cases as a')->whereColumn('a.router_result_id', 'r.id');
            })
            ->where('r.state', 'confirmed')->where('s.state', 'completed')
            ->where('r.segment', 'cordoba_jubilado')->where('r.province', 'cordoba')
            ->where('s.entry_received_at', '>=', $start)->where('s.entry_received_at', '>', now()->subHours(23))
            ->whereNotNull('s.recipient')->whereNotNull('r.send_started_at')
            ->select('r.id as result_id', 'r.send_started_at as landing_sent_at', 's.*')->orderBy('r.id')->limit(100)->get();
        $reserved = 0;
        $candidates = 0;
        foreach ($rows as $row) {
            $phone = Crypt::decryptString($row->recipient);
            if (! $this->allowed($phone)) {
                continue;
            }
            $candidates++;
            if (! $dispatch || ! config('edna.assistance_send_enabled')) {
                continue;
            }
            $delay = max(1, min(1440, (int) config('edna.assistance_delay_minutes', 30)));
            $scope = $row->scope;
            $reserved += DB::table('edna_assistance_cases')->insertOrIgnore([
                'router_result_id' => $row->result_id, 'scope' => $scope, 'request_id' => (string) Str::uuid(),
                'subject_id' => $row->subject_id, 'cascade_id' => $row->cascade_id, 'flow_id' => self::FLOW_ID,
                'recipient' => $row->recipient, 'journey_id' => $row->journey_id,
                'entry_received_at' => $row->entry_received_at,
                'due_at' => CarbonImmutable::parse($row->landing_sent_at)->addMinutes($delay),
                'state' => 'waiting', 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        if ($dispatch && config('edna.assistance_send_enabled')) {
            // Re-dispatching a job is safe: the send ledger arbitrates the single POST.
            foreach (DB::table('edna_assistance_cases')->where('state', 'waiting')->where('due_at', '<=', now())->orderBy('id')->limit(100)->pluck('id') as $id) {
                Queue::connection('edna_assistance')->push(new SendEdnaAssistance((int) $id), '', 'edna-assistance');
            }
        }

        return ['enabled' => true, 'candidates' => $candidates, 'reserved' => $reserved];
    }

    public function suppression(object $case): ?string
    {
        $phone = $case->recipient ? Crypt::decryptString($case->recipient) : '';
        if (! $this->allowed($phone) || $case->subject_id !== (string) config('edna.subject_id')
            || ! config('edna.assistance_start_at')
            || CarbonImmutable::parse($case->entry_received_at)->lt(CarbonImmutable::parse(config('edna.assistance_start_at')))) {
            return 'disabled_or_outside_pilot';
        }
        if (CarbonImmutable::parse($case->entry_received_at)->lt(now()->subHours(23))) {
            return 'conversation_window_elapsed';
        }
        if (CarbonImmutable::parse($case->due_at)->gt(now())) {
            return 'not_due';
        }
        if ($this->hasQueuedForm($phone)) {
            return 'form_queued_or_submitted';
        }
        $context = app(WhatsAppSalesContext::class)->resolve($phone, [
            'deal_categories' => [1, 5], 'form_since' => now()->subDays(60)->toIso8601String(),
            'advisor_since' => now()->subDays(30)->toIso8601String(),
            'any_form_since' => now()->subDays(30)->toIso8601String(),
        ]);

        return $context['evidence'] ? 'form_or_existing_management' : null;
    }

    // Called within the inbox transaction, before the legacy Router handler.
    public function receive(object $event, array $payload): bool
    {
        if (($payload['messageContent']['type'] ?? '') !== 'FLOW' || ! $this->allowed($payload['subscriber']['identifier'] ?? '')) {
            return false;
        }
        $case = DB::table('edna_assistance_cases')->where('request_id', $payload['replyOutMessageExternalRequestId'] ?? '')->lockForUpdate()->first();
        if (! $case || ! $case->recipient || $case->subject_id !== $event->subject_id
            || $case->flow_id !== self::FLOW_ID || Crypt::decryptString($case->recipient) !== $payload['subscriber']['identifier']) {
            return false;
        }
        if ($case->response_event_id) {
            return true;
        }
        if (in_array($case->state, ['sending', 'accepted', 'unknown'], true)) {
            throw new RuntimeException('Assistance awaits send confirmation.');
        }
        $received = CarbonImmutable::parse($payload['receivedAt']);
        if ($case->state !== 'confirmed' || ! $case->send_started_at
            || $case->outgoing_message_id !== ($payload['replyOutMessageId'] ?? null)
            || $received->lt(CarbonImmutable::parse($case->send_started_at)->subMinute())
            || $received->gt(CarbonImmutable::parse($case->entry_received_at)->addHours(24))) {
            return false;
        }
        $request = ['operation' => 'jubilados_assistance', 'request_id' => $case->request_id, 'event' => $payload,
            'context' => ['case_id' => (int) $case->id, 'flow_id' => self::FLOW_ID, 'verified' => true,
                'request_id' => $case->request_id, 'outgoing_message_id' => $case->outgoing_message_id]];
        try {
            $response = Http::asJson()->acceptJson()->connectTimeout(3)->timeout(25)->withoutRedirecting()
                ->post(config('edna.kestra_url'), $request);
            $result = $response->json();
            if (! $response->successful() || ($result['ok'] ?? null) !== true || ($result['kind'] ?? '') !== 'jubilados_assistance'
                || ($result['request_id'] ?? '') !== $case->request_id
                || ($result['event_key'] ?? '') !== $event->subject_id.':'.$event->message_id) {
                throw new RuntimeException('Invalid assistance acknowledgement.');
            }
            $decision = json_decode($result['assistance_result'] ?? '', true, 16, JSON_THROW_ON_ERROR);
            if (($decision['version'] ?? '') !== 'jubilados-assistance-v1'
                || ! in_array($decision['action'] ?? '', ['landing', 'intake', 'bank_rejected', 'review'], true)) {
                throw new RuntimeException('Invalid assistance decision.');
            }
            DB::table('edna_assistance_cases')->where('id', $case->id)->update([
                'state' => 'answered', 'response_event_id' => $event->id, 'response_received_at' => $received,
                'answer' => Crypt::encryptString($payload['messageContent']['text']),
                'decision' => json_encode($decision, JSON_THROW_ON_ERROR), 'updated_at' => now(),
            ]);
            Queue::connection('edna_assistance')->push(new ProcessEdnaAssistance((int) $case->id), '', 'edna-assistance');
        } catch (Throwable) {
            throw new RuntimeException('Assistance response unconfirmed; inspect the case ID.');
        }

        return true;
    }

    public function attribution(object $case): array
    {
        $journeys = new AttributionJourney;
        $journey = config('attribution.enabled') ? $journeys->find($case->journey_id) : null;
        $hash = $journeys->phoneHash(Crypt::decryptString($case->recipient));
        $valid = $journey && $journey->recipient_hash && $hash && hash_equals($journey->recipient_hash, $hash)
            && $journey->subject_id === $case->subject_id;
        $snapshot = $valid ? $journeys->snapshot($journey) : ['version' => 1, 'first' => [], 'last' => []];

        return $snapshot + ['status' => $valid ? 'resolved' : 'unknown', 'journey_id' => $valid ? $journey->id : null,
            'wa_assisted' => true, 'wa' => ['WA_ENTRY' => 'website', 'WA_FLOW' => 'web_whatsapp_router',
                'WA_FLOW_ID' => EdnaFlowRouter::FLOW_ID, 'WA_PROVINCE' => 'cordoba', 'WA_SEGMENT' => 'cordoba_jubilado']];
    }
}
