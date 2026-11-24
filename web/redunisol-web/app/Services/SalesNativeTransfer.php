<?php

namespace App\Services;

use Carbon\CarbonImmutable;

/** A matching native event certifies the observed effect; attribution additionally requires a positive POST acknowledgement. */
final class SalesNativeTransfer
{
    public static function fingerprint(EdnaBitrix $crm, int $chatId, int $sessionId, int $targetId, CarbonImmutable $at, ?int $ownerBefore): ?string
    {
        $stats = $crm->call('imopenlines.v2.Session.Stat.get', ['sessionId' => [$sessionId]]);
        $statsRows = $stats['sessions'] ?? [];
        $count = filter_var($statsRows[0]['transfersCount'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        $data = $crm->call('imopenlines.v2.Session.Transfer.list', ['sessionId' => [$sessionId]]);
        preg_match('#^/rest/([1-9][0-9]*)/#', (string) parse_url((string) config('edna.bitrix_url'), PHP_URL_PATH), $actor);
        $matches = [];
        if (isset($actor[1]) && is_array($statsRows) && count($statsRows) === 1 && (int) ($statsRows[0]['sessionId'] ?? 0) === $sessionId
            && $count !== false && is_array($data['transfers'] ?? null) && array_is_list($data['transfers'])
            && count($data['transfers']) === $count && ($data['hasNextPage'] ?? false) === false) {
            foreach ($data['transfers'] ?? [] as $t) {
                if ((int) ($t['sessionId'] ?? 0) === $sessionId && (string) ($t['initiatorId'] ?? '') === $actor[1]
                    && in_array((string) ($t['fromOperatorId'] ?? ''), [$actor[1], (string) $ownerBefore], true) && isset($t['fromOperatorId']) && (int) ($t['toOperatorId'] ?? 0) === $targetId
                    && ($t['type'] ?? '') === 'USER' && ($t['mode'] ?? '') === 'MANUAL' && (int) ($t['fromConfigId'] ?? 0) === 1
                    && in_array($t['toConfigId'] ?? null, [null, 1, '1'], true)
                    && (! isset($t['chatId']) || (int) $t['chatId'] === $chatId)
                    && is_string($t['date'] ?? null) && preg_match('/(?:Z|[+-]\d\d:\d\d)$/D', $t['date'])
                    && CarbonImmutable::parse($t['date'])->betweenIncluded($at, $at->addMinutes(2)->min(now()->addSeconds(5)))) {
                    $matches[] = hash('sha256', json_encode([$chatId, $sessionId, (int) $actor[1],
                        $targetId, CarbonImmutable::parse($t['date'])->utc()->toIso8601String()], JSON_THROW_ON_ERROR));
                }
            }
        }

        return count($matches) === 1 ? $matches[0] : null;
    }
}
