<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Throwable;

/** Bounds automatic recovery without discarding receipts of uncertain writes. */
class WebFormChatRetryPolicy
{
    public const WINDOW_HOURS = 8;

    public function expiresAt(object $route): CarbonImmutable
    {
        try {
            if (! is_string($route->created_at ?? null) || $route->created_at === '') {
                return CarbonImmutable::createFromTimestampUTC(0);
            }

            return CarbonImmutable::parse($route->created_at)->addHours(self::WINDOW_HOURS);
        } catch (Throwable) {
            return CarbonImmutable::createFromTimestampUTC(0);
        }
    }

    public function expired(object $route): bool
    {
        return $this->expiresAt($route)->lessThanOrEqualTo(now());
    }

    /** Equal jitter: 50–100% of a doubling interval, capped at 30 minutes. */
    public function delaySeconds(int $attempts): int
    {
        $ceiling = min(1800, 60 * (2 ** min(5, max(0, $attempts - 1))));

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
