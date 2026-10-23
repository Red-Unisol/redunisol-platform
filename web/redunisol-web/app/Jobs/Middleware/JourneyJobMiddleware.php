<?php

namespace App\Jobs\Middleware;

use App\Services\AttributionJourney;
use App\Services\JourneyLedger;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

class JourneyJobMiddleware
{
    public function handle(object $job, callable $next): mixed
    {
        if (! config('journey.enabled')) {
            return $next($job);
        }
        $outcome = 'completed';
        try {
            return $next($job);
        } catch (\Throwable $error) {
            $outcome = 'attempt_failed';
            throw $error;
        } finally {
            // At most two primary-key reads per business job, after its transaction.
            // Never inspect queue payloads, HTTP credentials or exception messages.
            try {
                $name = class_basename($job);
                $table = match (true) {
                    $name === 'SyncEdnaFormLink' => 'edna_form_links',
                    str_contains($name, 'Assistance') => 'edna_assistance_cases',
                    str_contains($name, 'FormLink') && isset($job->sendId) => 'edna_form_link_sends',
                    str_contains($name, 'Landing'), str_contains($name, 'RouterCrm') => 'edna_router_results',
                    str_contains($name, 'Flow') => 'edna_flow_sends',
                    isset($job->eventId), isset($job->entryEventId) => 'edna_incoming_events',
                    default => 'edna_out_of_hours_sends',
                };
                $id = $job->scope ?? $job->caseId ?? $job->resultId ?? $job->sendId ?? $job->eventId ?? $job->entryEventId ?? null;
                $row = $id ? DB::table($table)->where($table === 'edna_form_links' ? 'scope' : 'id', $id)->first() : null;
                $data = $row ? (array) $row : [];
                $links = [$table.'_id' => $id];
                if (! empty($data['recipient'])) {
                    $links['phone_hash'] = (new AttributionJourney)->phoneHash(Crypt::decryptString($data['recipient']));
                }
                if (! empty($data['payload'])) {
                    $payload = json_decode(Crypt::decryptString($data['payload']), true);
                    $links['phone_hash'] = (new AttributionJourney)->phoneHash((string) ($payload['subscriber']['identifier'] ?? ''));
                    $data['message'] = $payload;
                }
                foreach (['answer', 'link_text'] as $field) {
                    if (! empty($data[$field])) {
                        $data[$field] = Crypt::decryptString($data[$field]);
                    }
                }
                foreach (['content', 'decision'] as $field) {
                    if (! empty($data[$field]) && is_string($data[$field])) {
                        $data[$field] = json_decode($data[$field], true) ?? $data[$field];
                    }
                }
                unset($data['recipient'], $data['payload']);
                $send = ! empty($data['flow_send_id']) ? DB::table('edna_flow_sends')->find($data['flow_send_id']) : $row;
                foreach (['journey_id', 'request_id', 'flow_send_id', 'outgoing_message_id', 'crm_id', 'crm_entity', 'lead_id', 'contact_id'] as $key) {
                    if (! empty($data[$key])) {
                        $links[$key] = (string) $data[$key];
                    }
                }
                if (! empty($data['crm_id']) && in_array($data['crm_entity'] ?? '', ['lead', 'contact', 'deal'], true)) {
                    $links[$data['crm_entity'].'_id'] = (string) $data['crm_id'];
                }
                if ($send && ! empty($send->journey_id)) {
                    $links['journey_id'] = $send->journey_id;
                }
                app(JourneyLedger::class)->record('whatsapp.job', ['job' => $name, 'outcome' => $outcome, 'table' => $table, 'record' => $data], $links, 'whatsapp.edna');
            } catch (\Throwable) {
                app(JourneyLedger::class)->record('whatsapp.capture_failed', ['job' => class_basename($job)], [], 'whatsapp.edna');
            }
            app(JourneyLedger::class)->flush();
        }
    }
}
