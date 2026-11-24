<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Throwable;

/** Bounds automatic recovery without discarding receipts of uncertain writes. */
class WebFormChatRetryPolicy
{
    public const WINDOW_HOURS = 8;

    public const SALES_CUTOVER = '2026-11-19T14:00:00Z';

    public const QUEUED_SELLER = 'waiting_for_available_sales_pool';

    public function expiresAt(object $route): CarbonImmutable
    {
        try {
            if (! is_string($route->created_at ?? null) || $route->created_at === '') {
                return CarbonImmutable::createFromTimestampUTC(0);
            }

            return empty($route->retry_expires_at)
                ? CarbonImmutable::parse($route->created_at)->addHours(self::WINDOW_HOURS)
                : CarbonImmutable::parse($route->retry_expires_at);
        } catch (Throwable) {
            return CarbonImmutable::createFromTimestampUTC(0);
        }
    }

    public function expired(object $route): bool
    {
        return $this->expiresAt($route)->lessThanOrEqualTo(now());
    }

    /** Only earned by this exact entry, deal and authenticated session. */
    public function creditedSeconds(object $route): int
    {
        if (empty($route->retry_expires_at)) {
            return 0;
        }

        return max(0, $this->expiresAt($route)->timestamp
            - CarbonImmutable::parse($route->created_at)->addHours(self::WINDOW_HOURS)->timestamp);
    }

    public function salesHold(object $route, array $deal, array $entryTimes): ?array
    {
        if (($deal['STAGE_ID'] ?? '') !== 'C1:KESTRA_QUEUE' || (string) ($deal['ASSIGNED_BY_ID'] ?? '') !== '57'
            || (! empty($route->deal_id) && (string) $route->deal_id !== (string) $deal['ID'])) {
            return null;
        }
        $parts = explode('|', (string) ($deal['UF_CRM_KQ_REASON'] ?? ''), 4);
        if (count($parts) !== 4 || $parts[0] !== 'waiting_for_sales_opening' || $parts[3] === '') {
            return null;
        }
        try {
            foreach ([$parts[1], $parts[2]] as $utc) {
                if (! preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/D', $utc)) {
                    return null;
                }
            }
            if (! $this->newEntry([...$entryTimes, $deal['DATE_CREATE'] ?? null, $route->created_at])) {
                return null;
            }
            $start = CarbonImmutable::parse($parts[1])->max(CarbonImmutable::parse($route->created_at));
            if ($route->reason !== self::QUEUED_SELLER && $route->reason !== 'waiting_for_sales_opening') {
                // Previous failed identity/binding attempts keep their ordinary retry cost.
                $start = $start->max(CarbonImmutable::now());
            }
            if (! empty($route->sales_opening_at)) {
                $start = $start->max(CarbonImmutable::parse($route->sales_opening_at));
            }
            $open = CarbonImmutable::parse($parts[2]);
            if ($start->gt(now()) || $open->lte(now()) || $start->gte($this->expiresAt($route))) {
                return null;
            }

            return ['start' => $start, 'open' => $open];
        } catch (Throwable) {
            return null;
        }
    }

    public function newEntry(array $times): bool
    {
        $cut = CarbonImmutable::parse(self::SALES_CUTOVER);
        try {
            foreach ($times as $value) {
                if (! is_string($value) || ! preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/D', $value)
                    || CarbonImmutable::parse($value)->lt($cut)) {
                    return false;
                }
            }
        } catch (Throwable) {
            return false;
        }

        return true;
    }

    /** Equal jitter: 50–100% of a doubling interval, capped at 30 minutes. */
    public function delaySeconds(int $attempts, int $maximum = 1800): int
    {
        $ceiling = min($maximum, 60 * (2 ** min(5, max(0, $attempts - 1))));

        return random_int((int) ($ceiling / 2), $ceiling);
    }

    public function expiration(object $route): array
    {
        $proof = json_decode($route->proof ?? '{}', true);
        $uncertain = in_array($route->transfer_state ?? '', ['sending', 'unknown'], true)
            || (is_array($proof) && isset($proof['transfer_intent'])
                && ! in_array($route->transfer_state ?? '', ['confirmed', 'observed', 'not_needed', 'preserved'], true));

        return [
            'state' => $uncertain ? 'review' : 'expired',
            'reason' => $uncertain ? 'transfer_unresolved_after_retry_window' : 'retry_window_expired',
            'lease_token' => null, 'lease_until' => null, 'enqueued_at' => null, 'available_at' => null,
        ];
    }
}
