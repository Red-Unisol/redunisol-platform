<?php

namespace App\Services;

use Carbon\CarbonImmutable;

/** Matches a real Open Line transfer to an already-persisted POST intent without sending anything. */
final class SalesChatNativeTransfer
{
    public static function find(array $intent, callable $read): ?array
    {
        $stats = $read('imopenlines.v2.Session.Stat.get', ['sessionId' => [(int) $intent['session_id']]]);
        $sessions = $stats['sessions'] ?? null;
        if (! is_array($sessions) || ! array_is_list($sessions) || count($sessions) !== 1
            || (string) ($sessions[0]['sessionId'] ?? '') !== (string) $intent['session_id']
            || is_bool($sessions[0]['transfersCount'] ?? null)
            || filter_var($sessions[0]['transfersCount'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]) === false) {
            throw new SalesChatTransferEvidenceException('unknown', 'transfer_history_incomplete');
        }
        $data = $read('imopenlines.v2.Session.Transfer.list', ['sessionId' => [(int) $intent['session_id']]]);
        $rows = $data['transfers'] ?? null;
        if (! is_array($rows) || ! array_is_list($rows) || count($rows) < (int) $sessions[0]['transfersCount']
            || count($rows) >= 1000 || ($data['hasNextPage'] ?? false) !== false) {
            throw new SalesChatTransferEvidenceException('unknown', 'transfer_history_incomplete');
        }
        $matches = [];
        $created = CarbonImmutable::parse($intent['created_at']);
        foreach ($rows as $transfer) {
            if (! is_array($transfer) || (string) ($transfer['sessionId'] ?? '') !== (string) $intent['session_id']) {
                throw new SalesChatTransferEvidenceException('unknown', 'transfer_history_inconsistent');
            }
            if (! is_string($transfer['date'] ?? null) || ! preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', $transfer['date'])) {
                throw new SalesChatTransferEvidenceException('unknown', 'transfer_date_unverified');
            }
            $at = CarbonImmutable::parse($transfer['date']);
            if ((string) ($transfer['toOperatorId'] ?? '') !== (string) $intent['target_id']
                || ! array_key_exists('fromOperatorId', $transfer) || (string) $transfer['fromOperatorId'] !== (string) $intent['actor_id']
                || (string) ($transfer['fromConfigId'] ?? '') !== '1' || ! in_array($transfer['toConfigId'] ?? null, [null, 1, '1'], true)
                || ($transfer['type'] ?? '') !== 'USER' || ($transfer['mode'] ?? '') !== 'MANUAL'
                || (string) ($transfer['initiatorId'] ?? '') !== (string) $intent['actor_id']
                || (isset($transfer['chatId']) && (string) $transfer['chatId'] !== (string) $intent['chat_id'])
                || $at->lt($created) || $at->gt($created->addMinutes(2)) || $at->gt(now()->addSeconds(5))) {
                continue;
            }
            $tuple = ['chat_id' => (int) $intent['chat_id'], 'session_id' => (int) $intent['session_id'],
                'from_operator_id' => (int) ($transfer['fromOperatorId'] ?? 0), 'target_id' => (int) $transfer['toOperatorId'],
                'from_config_id' => 1, 'date' => $at->utc()->toIso8601String(), 'initiator_id' => $transfer['initiatorId'] ?? null];
            $tuple['sha256'] = hash('sha256', json_encode($tuple, JSON_THROW_ON_ERROR));
            $matches[$tuple['sha256']] = $tuple;
        }
        if (count($matches) > 1) {
            throw new SalesChatTransferEvidenceException('review', 'transfer_evidence_ambiguous');
        }

        return $matches ? array_values($matches)[0] : null;
    }
}
