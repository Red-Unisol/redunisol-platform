<?php

namespace App\Services;

use App\Jobs\ProcessEdnaIntake;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use RuntimeException;

class EdnaIntake
{
    public const CONTRACT = 'website-intake-v1';

    public function flowId(): ?string
    {
        $id = (string) config('edna.intake_flow_id');

        return preg_match('/^[0-9]{1,18}$/D', $id) && ! in_array($id, [EdnaFlowRouter::FLOW_ID, EdnaAssistance::FLOW_ID], true) ? $id : null;
    }

    public function allowed(string $phone): bool
    {
        $recipients = config('edna.intake_recipients', []);

        return config('edna.enabled') && config('edna.intake_enabled')
            && ($recipients === [] || in_array($phone, $recipients, true));
    }

    public function admit(string $subject, string $phone, ?string $journeyId, CarbonImmutable $received): ?object
    {
        $flowId = $this->flowId();
        if (! config('edna.enabled') || ! config('edna.intake_enabled') || ! $flowId || ! $journeyId) {
            return null;
        }
        $acceptNew = $this->allowed($phone) && config('edna.intake_start_at')
            && $received->gte(CarbonImmutable::parse(config('edna.intake_start_at')));

        return (new EdnaIntakePilot)->reserve($subject, $phone, $flowId, (bool) $acceptNew);
    }

    public function attribution(object $send): ?array
    {
        $journeys = new AttributionJourney;
        $journey = config('attribution.enabled') ? $journeys->find($send->journey_id) : null;
        $hash = $send->recipient ? $journeys->phoneHash(Crypt::decryptString($send->recipient)) : null;
        if (! $journey || ! $hash || ! $journey->recipient_hash
            || ! hash_equals($journey->recipient_hash, $hash) || $journey->subject_id !== $send->subject_id) {
            return null;
        }

        return $journeys->snapshot($journey) + ['status' => 'resolved', 'journey_id' => $journey->id,
            'wa_assisted' => true, 'wa' => ['WA_ENTRY' => 'website', 'WA_FLOW' => 'web_whatsapp_intake', 'WA_FLOW_ID' => $send->flow_id]];
    }

    public function canSend(object $send): bool
    {
        return config('edna.enabled') && config('edna.intake_enabled')
            && (new EdnaIntakePilot)->contains($send) && $this->attribution($send) !== null;
    }

    // Runs under the authenticated inbox transaction. The send ledger proves Flow identity.
    public function receive(object $event, array $payload): bool
    {
        if (($payload['messageContent']['type'] ?? '') !== 'FLOW') {
            return false;
        }
        $send = DB::table('edna_flow_sends')->where('request_id', $payload['replyOutMessageExternalRequestId'] ?? '')->first();
        if (! $send || $send->flow_id === EdnaFlowRouter::FLOW_ID) {
            return false;
        }
        $router = new EdnaFlowRouter;
        $context = $router->correlate($event, $payload, true);
        if (! $context || ! $this->canSend($send)) {
            throw new RuntimeException('Intake context requires review.');
        }
        $answer = json_decode($payload['messageContent']['text'], true, 16, JSON_THROW_ON_ERROR);
        if (! is_array($answer) || array_is_list($answer)) {
            throw new RuntimeException('Invalid intake answer.');
        }
        $existing = DB::table('edna_intake_requests')->where('flow_send_id', $send->id)->first();
        if ($existing) {
            $router->record($event->id, 'intake_duplicate_response', $send->id);

            return true;
        }
        $id = DB::table('edna_intake_requests')->insertGetId([
            'flow_send_id' => $send->id, 'response_event_id' => $event->id,
            'answer' => Crypt::encryptString(json_encode($answer, JSON_THROW_ON_ERROR)),
            'received_at' => CarbonImmutable::parse($payload['receivedAt']),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $router->complete($event, $context);
        Queue::connection('edna')->push(new ProcessEdnaIntake($id), '', 'edna');

        return true;
    }
}
