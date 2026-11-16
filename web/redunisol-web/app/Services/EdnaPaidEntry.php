<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/** Classifies the current authenticated entry; never infers a campaign from a CRM owner or old acquisition. */
class EdnaPaidEntry
{
    // Public prefilled codes specified in Bitrix 23229/23279. They are labels,
    // not Meta/Google ad IDs, and do not prove that an asset has been configured.
    public const GOOGLE_CODES = [
        'G-CBAJUB-MED', 'G-CBAJUB-GEN', 'G-CBAJUB-CTA', 'G-CBAGEN-EMP', 'G-CBAGEN-POL',
        'G-CATGEN-EMP', 'G-CATGEN-POL', 'G-CABA-PFA', 'G-CBASNM-JUB', 'G-CATSNM-COMP',
        'G-CATSNM-HAB', 'G-CATSNM-GEO', 'G-CATSM-PROV', 'G-CATSM-PURA', 'G-CUENTA',
    ];

    // Read from the account-level Google Ads Message asset on 2026-11-11.
    // This text proves the declared loan/ad intent for routing; it is not an ad ID
    // and cannot distinguish Google from another platform using the same words.
    private const AD_PREFILL = 'hola vi un anuncio de red unisol y quiero info sobre prestamos acepto ser contactado por este medio';

    private const PAID_MEDIA = ['cpc', 'ppc', 'paid', 'paidsearch', 'paidsocial',
        'paidmedia', 'socialpaid', 'display', 'cpm', 'cpv'];

    public function classify(object $event, array $payload): ?array
    {
        try {
            $stored = json_decode(Crypt::decryptString($event->payload ?? ''), true, 32, JSON_THROW_ON_ERROR);
            if (! is_array($stored) || $stored !== $payload
                || ($payload['subjectId'] ?? null) !== (string) config('edna.subject_id')
                || ($payload['subjectId'] ?? null) !== $event->subject_id
                || ($payload['id'] ?? null) !== $event->message_id
                || ! in_array($payload['messageContent']['type'] ?? '', ['TEXT', 'BUTTON', 'IMAGE', 'AUDIO', 'DOCUMENT', 'VIDEO', 'LIST_PICKER'], true)
                || ! is_string($payload['receivedAt'] ?? null)
                || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', $payload['receivedAt'])
                || ! (new AttributionJourney)->phoneHash((string) ($payload['subscriber']['identifier'] ?? ''))) {
                return null;
            }
            $received = CarbonImmutable::parse($payload['receivedAt']);
            if ($received->gt(now()->addMinutes(5))) {
                return null;
            }
            $text = (string) ($payload['messageContent']['text'] ?? '');
            $code = $this->googleCode($text);
            $referral = $payload['messageContent']['referral'] ?? null;
            if (is_array($referral)) {
                $type = $this->alias($referral, 'source_type', 'sourceType');
                $id = $this->alias($referral, 'source_id', 'sourceId');
                if ($type === 'ad' && $id !== false) {
                    $evidence = ['kind' => 'provider_ad_referral', 'source_type' => 'ad'];
                    if (is_string($id) && preg_match('/^[A-Za-z0-9_-]{1,128}$/D', $id)) {
                        $evidence['source_id'] = $id;
                    }
                    if ($code) {
                        $evidence['campaign_code'] = $code;
                        $evidence['network'] = 'unknown';
                        $evidence['conflict'] = 'provider_ad_and_google_code';
                    }

                    return $this->decision($evidence);
                }
                // Contradictory provider aliases are not proof of either origin.
                if ($type === false || $id === false) {
                    return null;
                }
            }
            if ($code) {
                return $this->decision(['kind' => 'google_campaign_code', 'network' => 'google', 'campaign_code' => $code]);
            }
            if ($this->plain($text) === self::AD_PREFILL) {
                return $this->decision(['kind' => 'documented_ad_prefill', 'network' => 'unknown', 'template_id' => 'account_loan_ad_20261111']);
            }

            return $this->trackedEntry($payload, $received);
        } catch (Throwable) {
            // Never log an inbox body, a click identifier or a credential-bearing exception.
            return null;
        }
    }

    private function trackedEntry(array $payload, CarbonImmutable $received): ?array
    {
        if (! config('attribution.enabled')) {
            return null;
        }
        $text = (string) ($payload['messageContent']['text'] ?? '');
        if (preg_match_all('/\(ref\s*:/i', $text) !== 1
            || ! preg_match('/\(ref:\s*('.AttributionJourney::REFERENCE_PATTERN.')\)/i', $text, $match)) {
            return null;
        }
        $id = strlen($match[1]) === 24 ? strtolower($match[1]) : $match[1];
        // SELECT only: AttributionJourney::find/bind can import or bind rows.
        $connection = config('attribution.connection');
        $row = DB::connection($connection)->table('attribution_journeys')->where('id', $id)->first();
        if (! $row && $connection === 'journey') {
            $row = DB::connection()->table('attribution_journeys')->where('id', $id)->first();
        }
        $hash = (new AttributionJourney)->phoneHash($payload['subscriber']['identifier']);
        if (! $row || CarbonImmutable::parse($row->expires_at)->lte(now())
            || ($row->recipient_hash && (! hash_equals($row->recipient_hash, $hash)
            || (string) $row->subject_id !== $payload['subjectId']))) {
            return null;
        }
        $snapshot = json_decode(Crypt::decryptString($row->snapshot), true, 32, JSON_THROW_ON_ERROR);
        $touch = $snapshot['last'] ?? null;
        if (! is_array($touch) || ($touch['utm_campaign'] ?? '') === 'web_whatsapp_router'
            || ! is_string($touch['at'] ?? null)) {
            return null;
        }
        $at = CarbonImmutable::parse($touch['at']);
        // A retained first touch/cookie from a previous visit does not prove
        // that this new inquiry is paid. Use only the recent, linked last touch.
        if ($at->gt($received->addMinutes(5)) || $at->lt($received->subDay())) {
            return null;
        }
        $evidence = ['kind' => 'tracked_paid_click', 'journey_id' => $id];
        foreach (['gclid', 'gbraid', 'wbraid'] as $key) {
            if (is_string($touch[$key] ?? null) && trim($touch[$key]) !== '' && strlen($touch[$key]) <= 256) {
                return $this->decision($evidence + ['signal' => $key, 'network' => 'google']);
            }
        }
        $medium = strtolower(trim(is_string($touch['utm_medium'] ?? null) ? $touch['utm_medium'] : ''));
        $medium = preg_replace('/[\s_-]+/', '', $medium);
        if (in_array($medium, self::PAID_MEDIA, true)) {
            // The original snapshot retains source/medium and real click IDs;
            // routing evidence itself deliberately contains none of those IDs.
            return $this->decision($evidence + ['signal' => 'paid_medium', 'medium' => $medium]);
        }

        return null;
    }

    private function googleCode(string $text): ?string
    {
        if (preg_match_all('/\(ref\s*:/i', $text) !== 1
            || ! preg_match('/\(ref:\s*(G-[A-Z0-9-]{1,32})\s*\)/i', $text, $match)) {
            return null;
        }
        $code = strtoupper($match[1]);

        return in_array($code, self::GOOGLE_CODES, true) ? $code : null;
    }

    private function alias(array $value, string $snake, string $camel): string|false|null
    {
        $a = $value[$snake] ?? null;
        $b = $value[$camel] ?? null;
        if (($a !== null && ! is_string($a)) || ($b !== null && ! is_string($b))
            || ($a !== null && $b !== null && $a !== $b)) {
            return false;
        }

        return $a ?? $b;
    }

    private function plain(string $text): string
    {
        return trim(preg_replace('/[^a-z0-9]+/', ' ', strtolower(Str::ascii($text))));
    }

    private function decision(array $evidence): array
    {
        return ['version' => 1, 'route' => 'paid_direct_v3', 'evidence' => $evidence];
    }
}
