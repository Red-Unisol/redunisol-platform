<?php

namespace App\Services;

use App\Jobs\SendEdnaOutOfHours;
use App\Models\EdnaOutOfHoursSend;
use App\Support\WhatsAppOutOfHoursSettings;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

class EdnaOutOfHours
{
    public function eligible(object $event, array $payload, array $settings): ?array
    {
        if (! $this->transportReady($event, $payload, $settings)) {
            return null;
        }

        return (new EdnaOutOfHoursPolicy)->window((new EdnaOutOfHoursPolicy)->decide($event, $payload, $settings));
    }

    public function transportReady(object $event, array $payload, array $settings): bool
    {
        $phone = $payload['subscriber']['identifier'];
        $allowed = config('edna.out_of_hours_recipients', []);

        return config('edna.enabled') && config('edna.out_of_hours_enabled') && $settings['enabled']
            && $event->out_of_hours_candidate && (string) $event->subject_id === (string) config('edna.subject_id')
            && preg_match('/^[0-9]{10,15}$/D', $phone) && (! $allowed || in_array($phone, $allowed, true));
    }

    // Transport checks under the person lock; no HTTP call may hold that lock.
    public function stillReady(object $event, array $payload, array $settings, array $window): bool
    {
        return $settings === (new WhatsAppOutOfHoursSettings)->get()
            && $this->transportReady($event, $payload, $settings)
            && $window['start']->lte(now()) && $window['end']->gt(now())
            && ! $this->automaticRoute($event, $payload);
    }

    public function automaticRoute(object $event, array $payload): bool
    {
        if (($payload['messageContent']['type'] ?? '') === 'FLOW') {
            return true;
        }
        $scope = (new EdnaFlowRouter)->scope((string) $event->subject_id, $payload['subscriber']['identifier']);
        $query = DB::table('edna_flow_sends')->where('scope', $scope)->where('created_at', '>', now()->subHours(24));
        if ((clone $query)->whereIn('state', ['pending', 'sending', 'accepted', 'unknown', 'confirmed', 'completed'])->exists()) {
            return true;
        }
        $request = $payload['replyOutMessageExternalRequestId'] ?? null;
        // Other senders use opaque references rather than our UUIDs.
        // PostgreSQL rejects those values even when the lookup would find no row.
        $request = is_string($request) && Str::isUuid($request) ? $request : null;
        $outgoing = $payload['replyOutMessageId'] ?? null;
        if (($request && (clone $query)->where('request_id', $request)->exists())
            || ($outgoing && (clone $query)->where('outgoing_message_id', (string) $outgoing)->exists())) {
            return true;
        }
        if (! $request && ! $outgoing) {
            return false;
        }
        $landing = DB::table('edna_router_results')->join('edna_flow_sends', 'edna_flow_sends.id', '=', 'edna_router_results.flow_send_id')
            ->where('edna_flow_sends.scope', $scope)->where('edna_router_results.created_at', '>', now()->subHours(24));
        if ($landing->where(function ($q) use ($request, $outgoing): void {
            if ($request) {
                $q->where('edna_router_results.request_id', $request);
            }
            if ($outgoing) {
                $q->orWhere('edna_router_results.outgoing_message_id', (string) $outgoing);
            }
        })->exists()) {
            return true;
        }
        $phoneHash = (new AttributionJourney)->phoneHash($payload['subscriber']['identifier']);
        $formScope = hash('sha256', $event->subject_id.':'.$phoneHash);

        return DB::table('edna_form_link_sends')->where('scope', $formScope)->where('created_at', '>', now()->subHours(24))
            ->where(function ($q) use ($request, $outgoing): void {
                if ($request) {
                    $q->where('request_id', $request);
                }
                if ($outgoing) {
                    $q->orWhere('outgoing_message_id', (string) $outgoing);
                }
            })->exists();
    }

    public function reserve(object $event, array $payload, array $context, array $settings): ?int
    {
        if (! $this->transportReady($event, $payload, $settings)) {
            return null;
        }
        $policy = new EdnaOutOfHoursPolicy;
        $decision = $policy->decide($event, $payload, $settings, $context);
        $window = $policy->window($decision);
        if ($decision['decision'] !== 'send' || ! $window) {
            return null;
        }
        if (! in_array($decision['notice_type'], ['general', 'managed'], true)) {
            throw new \RuntimeException('Invalid Kestra notice type.');
        }

        return DB::transaction(function () use ($event, $payload, $context, $settings, $window, $decision): ?int {
            $phone = $payload['subscriber']['identifier'];
            $scope = (new EdnaFlowRouter)->scope((string) $event->subject_id, $phone);
            DB::table('edna_router_contacts')->insertOrIgnore(['scope' => $scope, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('edna_router_contacts')->where('scope', $scope)->lockForUpdate()->first();
            if (! $this->stillReady($event, $payload, $settings, $window) || EdnaOutOfHoursSend::where('event_id', $event->id)->exists()
                || EdnaOutOfHoursSend::where('scope', $scope)->where('window_start', '<', $window['end'])
                    ->where('window_end', '>', $window['start'])->exists()) {
                return null;
            }
            $send = EdnaOutOfHoursSend::create([
                'event_id' => $event->id, 'scope' => $scope, 'request_id' => (string) Str::uuid(),
                'subject_id' => $event->subject_id, 'cascade_id' => (string) config('edna.cascade_id'),
                'received_at' => CarbonImmutable::parse($payload['receivedAt'])->utc(),
                'window_start' => $window['start'], 'window_end' => $window['end'],
                'recipient' => $phone, 'notice_type' => $decision['notice_type'], 'advisor_id' => $context['advisor_id'] ?? null,
                'crm_entity' => $context['entity'] ?? null, 'crm_id' => $context['id'] ?? null,
                'policy_version' => $decision['policy_version'], 'policy_reason' => $decision['reason'],
                'message_text' => (new WhatsAppOutOfHoursSettings)->personalize($decision['message_template'], $context),
            ]);
            Queue::connection('edna')->push(new SendEdnaOutOfHours($send->id), '', 'edna');

            return $send->id;
        });
    }
}
