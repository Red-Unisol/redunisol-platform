<?php

use App\Jobs\SendEdnaFlow;
use App\Services\EdnaFlowRouter;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Ramsey\Uuid\Uuid;

// Explicit operator-only acceptance procedure. Not loaded by the application or a scheduler.
final class EdnaPilotCase
{
    public const CASES = ['cordoba-jubilado', 'cordoba-docente', 'catamarca-policia', 'otra-provincia'];

    public static function run(string $case, int $eventId, bool $apply = false): array
    {
        if (! in_array($case, self::CASES, true) || $eventId < 1) {
            throw new RuntimeException('Unsupported acceptance case.');
        }

        return DB::transaction(function () use ($case, $eventId, $apply): array {
            $allowed = config('edna.router_recipients', []);
            if (! config('edna.enabled') || ! config('edna.router_enabled') || ! config('edna.results_enabled')
                || count($allowed) !== 1 || ! preg_match('/^[0-9]{10,15}$/D', $allowed[0])
                || config('edna.subject_id') !== '2423' || config('edna.cascade_id') !== '2557'
                || ! config('edna.api_key') || ! config('edna.router_start_at')) {
                throw new RuntimeException('Single-recipient Sales pilot must be enabled.');
            }
            $event = DB::table('edna_incoming_events')->where('id', $eventId)->lockForUpdate()->first();
            if (! $event || $event->subject_id !== '2423' || $event->status !== 'delivered'
                || $event->outcome !== 'router_entry' || ! $event->payload) {
                throw new RuntimeException('A delivered router entry is required.');
            }
            $payload = json_decode(Crypt::decryptString($event->payload), true, 32, JSON_THROW_ON_ERROR);
            $marker = 'Hola, vengo del sitio web de Red Unisol. prueba-router-'.$case;
            if (($payload['subscriber']['identifier'] ?? '') !== $allowed[0]
                || ($payload['messageContent']['type'] ?? '') !== 'TEXT'
                || ($payload['messageContent']['text'] ?? '') !== $marker) {
                throw new RuntimeException('Entry must match the exact pilot case and recipient.');
            }
            $router = new EdnaFlowRouter;
            $scope = $router->scope('2423', $allowed[0]);
            if (! DB::table('edna_router_contacts')->where('scope', $scope)->lockForUpdate()->first()) {
                throw new RuntimeException('Existing pilot scope is required.');
            }
            $request = Uuid::uuid5(Uuid::NAMESPACE_URL, 'https://redunisol.com.ar/edna-acceptance/20260918/'.$case)->toString();
            $existing = DB::table('edna_flow_sends')->where('request_id', $request)->first();
            if ($existing) {
                if ((int) $existing->entry_event_id !== $eventId || $existing->scope !== $scope) {
                    throw new RuntimeException('Case is already bound to a different entry.');
                }

                return ['case' => $case, 'flow_send_id' => $existing->id, 'state' => $existing->state, 'created' => false];
            }
            $received = CarbonImmutable::parse($payload['receivedAt'])->utc();
            if ($received->lt(now()->subMinutes(15)) || $received->gt(now()->addMinutes(5))
                || $received->lt(CarbonImmutable::parse(config('edna.router_start_at')))) {
                throw new RuntimeException('Pilot entry must be recent.');
            }
            if ($event->router_action !== 'cooldown' || DB::table('edna_flow_sends')->where('entry_event_id', $eventId)->exists()) {
                throw new RuntimeException('Only a fresh entry stopped by cooldown can be released.');
            }
            $sends = DB::table('edna_flow_sends')->where('scope', $scope)->get();
            foreach ($sends as $send) {
                $result = DB::table('edna_router_results')->where('flow_send_id', $send->id)->first();
                if ($send->state !== 'completed' || ! $result || $result->state !== 'confirmed' || $result->crm_state !== 'synced') {
                    throw new RuntimeException('Finish and verify the previous pilot before another case.');
                }
            }
            if (! $apply) {
                return ['case' => $case, 'event_id' => $eventId, 'ready' => true, 'created' => false];
            }
            $id = DB::table('edna_flow_sends')->insertGetId([
                'request_id' => $request, 'entry_event_id' => $eventId, 'scope' => $scope,
                'subject_id' => '2423', 'cascade_id' => '2557', 'flow_id' => EdnaFlowRouter::FLOW_ID,
                'recipient' => Crypt::encryptString($allowed[0]), 'state' => 'pending',
                'entry_received_at' => $received, 'created_at' => now(), 'updated_at' => now(),
            ]);
            Queue::connection('edna')->push(new SendEdnaFlow($id), '', 'edna');
            $router->record($eventId, 'pilot_scheduled', $id);

            return ['case' => $case, 'flow_send_id' => $id, 'state' => 'pending', 'created' => true];
        });
    }
}
