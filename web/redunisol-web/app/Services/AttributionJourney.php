<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AttributionJourney
{
    public const REFERENCE_PATTERN = '(?:[A-Za-z0-9]{10}|[a-f0-9]{24})';

    public const COOKIE = 'ru_attribution';

    public const UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

    public const CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'fbclid'];

    public const CRM_FIELDS = ['JOURNEY_ID', 'ATTR_JSON', 'ATTR_STATUS', 'GCLID', 'GBRAID', 'WBRAID', 'FBCLID', 'LANDING_ORIGEN', 'FECHA_ORIGEN'];

    public function find(mixed $id): ?object
    {
        if (! is_string($id) || ! preg_match('/^'.self::REFERENCE_PATTERN.'$/D', $id)) {
            return null;
        }

        return DB::table('attribution_journeys')->where('id', $id)->where('expires_at', '>', now())->first();
    }

    public function snapshot(object $journey): array
    {
        return json_decode(Crypt::decryptString($journey->snapshot), true, 32, JSON_THROW_ON_ERROR);
    }

    public function create(array $snapshot): object
    {
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $id = Str::random(10);
            // The primary key arbitrates collisions atomically, including concurrent requests.
            $inserted = DB::table('attribution_journeys')->insertOrIgnore([
                'id' => $id, 'snapshot' => Crypt::encryptString(json_encode($snapshot, JSON_THROW_ON_ERROR)),
                'expires_at' => now()->addDays(config('attribution.days', 30)),
                'created_at' => now(), 'updated_at' => now(),
            ]);
            if ($inserted) {
                return $this->find($id);
            }
        }

        throw new \RuntimeException('Unable to allocate an attribution reference.');
    }

    public function touch(Request $request): ?object
    {
        // An explicit return reference wins over internal WhatsApp UTMs, even if invalid.
        if ($request->query->has('ref')) {
            return $this->find($request->query('ref'));
        }
        $previous = $this->find($request->cookie(self::COOKIE));
        $touch = $this->acquisition($request->query(), $request->url());
        if ($previous && ! $touch['tagged']) {
            return $previous;
        }
        $snapshot = $previous ? $this->snapshot($previous) : [];
        $first = $snapshot['first'] ?? $touch;

        return $this->create(['version' => 1, 'first' => $first, 'last' => $touch]
            + array_intersect_key($snapshot, array_flip(['ga_client_id', 'ga_session_id'])));
    }

    public function recordAnalytics(mixed $id, array $input): void
    {
        if (! is_string($id) || ! preg_match('/^'.self::REFERENCE_PATTERN.'$/D', $id)) {
            return;
        }

        DB::transaction(function () use ($id, $input) {
            $journey = DB::table('attribution_journeys')->where('id', $id)
                ->where('expires_at', '>', now())->lockForUpdate()->first();
            if (! $journey) {
                return;
            }
            $snapshot = $this->snapshot($journey);
            // Preserve the first observed analytics identity across returns and campaigns.
            // Never combine an older client ID with another browser's session ID.
            if (isset($snapshot['ga_client_id']) && $snapshot['ga_client_id'] !== $input['ga_client_id']) {
                return;
            }
            $enriched = $snapshot + array_filter($input, static fn ($value) => $value !== null);
            if ($enriched === $snapshot) {
                return;
            }
            $snapshot = $enriched;
            DB::table('attribution_journeys')->where('id', $id)->update([
                'snapshot' => Crypt::encryptString(json_encode($snapshot, JSON_THROW_ON_ERROR)),
                'updated_at' => now(),
            ]);
        });
    }

    public function acquisition(array $input, string $url): array
    {
        $touch = [];
        foreach ([...self::UTMS, ...self::CLICK_IDS] as $key) {
            $value = $input[$key] ?? null;
            if (is_string($value) && trim($value) !== '') {
                $touch[$key] = Str::limit(trim($value), in_array($key, self::UTMS) ? 150 : 256, '');
            }
        }
        // These labels describe transport, never new acquisition.
        if (($touch['utm_campaign'] ?? '') === 'web_whatsapp_router') {
            $touch = [];
        }
        $tagged = count($touch) > 0;
        $parts = parse_url($url);
        $landing = is_array($parts) ? ($parts['scheme'] ?? 'https').'://'.($parts['host'] ?? '').($parts['path'] ?? '/') : '';

        return $touch + ['landing' => Str::limit($landing, 1024, ''), 'at' => now()->toIso8601String(), 'tagged' => $tagged];
    }

    public function bind(string $text, string $phone, string $subject): ?string
    {
        if (! config('attribution.enabled') || ! preg_match('/\(ref:\s*('.self::REFERENCE_PATTERN.')\)/i', $text, $match)) {
            return null;
        }

        // Legacy hex references were case-insensitive; new base62 references are not.
        $id = strlen($match[1]) === 24 ? strtolower($match[1]) : $match[1];

        return DB::transaction(function () use ($id, $phone, $subject) {
            $journey = DB::table('attribution_journeys')->where('id', $id)
                ->where('expires_at', '>', now())->lockForUpdate()->first();
            if (! $journey) {
                return null;
            }
            $hash = $this->phoneHash($phone);
            if (! $hash || ($journey->recipient_hash && (! hash_equals($journey->recipient_hash, $hash) || $journey->subject_id !== $subject))) {
                return null;
            }
            if (! $journey->recipient_hash) {
                DB::table('attribution_journeys')->where('id', $journey->id)->update([
                    'recipient_hash' => $hash, 'subject_id' => $subject, 'bound_at' => now(), 'updated_at' => now(),
                ]);
            }

            return $journey->id;
        });
    }

    public function phoneHash(string $phone): ?string
    {
        $digits = preg_replace('/\D/', '', $phone);
        if (str_starts_with($digits, '00')) {
            $digits = substr($digits, 2);
        }
        if (strlen($digits) === 13 && str_starts_with($digits, '549')) {
            $digits = substr($digits, 3);
        } elseif (strlen($digits) === 12 && str_starts_with($digits, '54')) {
            $digits = substr($digits, 2);
        }
        if (! preg_match('/^[1-9][0-9]{9}$/D', $digits)) {
            return null;
        }

        return hash_hmac('sha256', $digits, (string) config('app.key'));
    }

    public function resolveForm(Request $request, array $input): array
    {
        if (! config('attribution.enabled')) {
            return $input;
        }
        // Never accept a browser-supplied snapshot, WA flags or attribution decision.
        $ref = $input['ref'] ?? $request->cookie(self::COOKIE);
        $journey = $this->find($ref);
        $hash = $this->phoneHash((string) ($input['celular'] ?? ''));
        $valid = $journey && (! $journey->recipient_hash || ($hash && hash_equals($journey->recipient_hash, $hash)));
        if ($valid) {
            $snapshot = $this->snapshot($journey);
            $status = 'resolved';
        } elseif ($ref) {
            // An invalid, expired or shared reference must not fall back to unrelated cookies.
            $snapshot = ['version' => 1, 'first' => [], 'last' => []];
            $status = 'unresolved_ref';
        } else {
            $touch = $this->acquisition($input, (string) ($input['landing_url'] ?? ''));
            $snapshot = ['version' => 1, 'first' => $touch, 'last' => $touch];
            $status = $touch['tagged'] ? 'url_only' : 'unknown';
        }
        $assisted = $valid && $journey->bound_at !== null;
        $input['attribution'] = $snapshot + [
            'journey_id' => $valid ? $journey->id : null,
            'status' => $status, 'wa_assisted' => $assisted,
            'wa' => $assisted ? $this->waContext($journey->id) : [],
        ];
        foreach (self::UTMS as $key) {
            unset($input[$key]);
            if (! empty($snapshot['last'][$key])) {
                $input[$key] = $snapshot['last'][$key];
            }
        }

        return $input;
    }

    private function waContext(string $journeyId): array
    {
        $result = DB::table('edna_router_results as r')
            ->join('edna_flow_sends as s', 's.id', '=', 'r.flow_send_id')
            ->where('s.journey_id', $journeyId)->where('s.state', 'completed')
            ->select('r.province', 'r.segment', 'r.response_received_at')->first();
        if (! $result) {
            return [];
        }

        return ['WA_FLOW' => 'web_whatsapp_router', 'WA_PROVINCE' => $result->province,
            'WA_SEGMENT' => $result->segment, 'WA_FLOW_ID' => EdnaFlowRouter::FLOW_ID,
            'WA_TIMESTAMP' => CarbonImmutable::parse($result->response_received_at)->toIso8601String()];
    }

    public function crmFields(object $journey): array
    {
        $snapshot = $this->snapshot($journey);
        $fields = [
            'UF_CRM_JOURNEY_ID' => $journey->id,
            'UF_CRM_ATTR_JSON' => json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'UF_CRM_ATTR_STATUS' => 'resolved',
        ];
        foreach (['gclid' => 'GCLID', 'gbraid' => 'GBRAID', 'wbraid' => 'WBRAID', 'fbclid' => 'FBCLID',
            'landing' => 'LANDING_ORIGEN', 'at' => 'FECHA_ORIGEN'] as $key => $field) {
            // Clear older acquisition metadata when the current journey has none.
            $fields['UF_CRM_'.$field] = $snapshot['last'][$key] ?? '';
        }

        return $fields;
    }
}
