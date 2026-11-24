<?php

namespace App\Actions;

use App\Jobs\PersistFormSubmission;
use App\Services\AttributionJourney;
use App\Services\EdnaAssistance;
use App\Services\JourneyLedger;
use Throwable;

class PrepareWebFormSubmission
{
    public function __construct(private readonly PrequalifyFormWithKestra $prequalifyFormWithKestra) {}

    public function evaluate(array $input, array $clientContext, string $continuationReference): array
    {
        $prequalificationResponse = null;

        try {
            $prequalificationResponse = $this->prequalifyFormWithKestra->execute($input);
        } catch (Throwable $exception) {
            logger()->warning('Web form prequalification unavailable.', ['error' => $exception::class]);
        }

        $prequalification = $prequalificationResponse?->json();
        $prequalificationAvailable = $prequalificationResponse !== null
            && $prequalificationResponse->successful()
            && is_array($prequalification)
            && ($prequalification['ok'] ?? false) === true;
        $qualified = $prequalificationAvailable
            && ($prequalification['prequalified'] ?? false) === true;
        $routeToWhatsapp = $qualified
            && ($prequalification['route_to_whatsapp'] ?? true) === true;
        $response = ! $prequalificationAvailable ? [
            'ok' => true,
            'qualified' => false,
            'prequalified' => false,
            'route_to_whatsapp' => false,
            'action' => 'not_qualified',
            'reason' => 'prequalification_unavailable',
            'message' => 'Recibimos tu solicitud. La verificación está pendiente.',
            'persistence' => 'queued',
        ] : [
            'ok' => true,
            'tracking' => isset($input['attribution']) ? array_intersect_key($input, array_flip(AttributionJourney::UTMS)) : null,
            'qualified' => $qualified,
            'prequalified' => $qualified,
            'route_to_whatsapp' => $routeToWhatsapp,
            'action' => $routeToWhatsapp ? 'qualified' : 'rejected',
            'reason' => (string) ($prequalification['reason'] ?? ''),
            'message' => (string) ($prequalification['message'] ?? ''),
            'rule_version' => (string) ($prequalification['rule_version'] ?? ''),
            'persistence' => 'queued',
            'web_form_reference' => $routeToWhatsapp ? $continuationReference : null,
        ];
        $job = new PersistFormSubmission(
            input: $input,
            qualified: $qualified,
            reconcileAcknowledgement: true,
            prequalification: [
                'available' => $prequalificationAvailable,
                'prequalified' => $qualified,
                'route_to_whatsapp' => $routeToWhatsapp,
                'reason' => $prequalificationAvailable ? (string) ($prequalification['reason'] ?? '') : 'prequalification_unavailable',
                'message' => $prequalificationAvailable ? (string) ($prequalification['message'] ?? '') : '',
                'rule_version' => $prequalificationAvailable ? (string) ($prequalification['rule_version'] ?? '') : '',
            ],
            clientContext: $clientContext,
        );

        return [$job, $response];
    }

    public function record(PersistFormSubmission $job): void
    {
        $ledger = app(JourneyLedger::class);
        $ledger->record('form.prequalified', ['qualified' => $job->qualified] + array_intersect_key($job->prequalification,
            array_flip(['available', 'route_to_whatsapp', 'reason', 'rule_version'])), $job->input['_journey_links']);
        $ledger->flush();
        if (config('edna.assistance_enabled')) {
            try {
                (new EdnaAssistance)->recordForm((string) ($job->input['celular'] ?? ''));
            } catch (Throwable $error) {
                logger()->warning('Web form assistance tracking unavailable.', ['error' => $error::class]);
            }
        }
    }
}
