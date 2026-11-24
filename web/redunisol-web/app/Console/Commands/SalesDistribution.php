<?php

namespace App\Console\Commands;

use App\Services\EdnaBitrix;
use App\Services\SalesChatTransfer;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use RuntimeException;

class SalesDistribution extends Command
{
    protected $signature = 'sales:distribution {--day= : Day of session opening (YYYY-MM-DD, Argentina)}
        {--first-24-hours : Compare the complete day of openings at equal follow-up age}';

    protected $description = 'Count distinct VENTAS chats with new sessions and their native transfers for the selected opening cohort';

    // Native VENTAS receipts cross-checked with the 10 November 2026 default-operator change.
    // Indexed by native session. The chat id and exact UTC second must also match.
    private const RESTORATIONS = [
        305375 => [139909, '2026-11-10T17:39:25Z'],
        313083 => [136881, '2026-11-10T17:39:27Z'],
        313251 => [143197, '2026-11-10T17:39:29Z'],
        313265 => [121523, '2026-11-10T17:39:31Z'],
        313271 => [143559, '2026-11-10T17:42:28Z'],
        313419 => [98611, '2026-11-10T17:42:30Z'],
        313471 => [143677, '2026-11-10T17:42:33Z'],
        313689 => [143827, '2026-11-10T17:42:35Z'],
    ];

    public function handle(EdnaBitrix $crm): int
    {
        $now = CarbonImmutable::now('America/Argentina/Buenos_Aires');
        $day = $this->option('day') ?: $now->toDateString();
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/D', $day)) {
            return self::INVALID;
        }
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $day, $now->timezone);
        if (! $start || $start->toDateString() !== $day || $start->gt($now)) {
            return self::INVALID;
        }
        $end = $start->addDay()->min($now);
        $fixedAge = (bool) $this->option('first-24-hours');
        if ($fixedAge && $start->addDay()->addHours(24)->gt($now)) {
            $this->error('La cohorte todavía no completó las primeras 24 horas de seguimiento.');

            return self::INVALID;
        }
        $openedAt = $sessions = $chats = [];
        $offset = 0;
        do {
            $page = $crm->call('imopenlines.v2.Session.list', ['configId' => 1,
                'dateCreateFrom' => $start->toIso8601String(), 'dateCreateTo' => $end->toIso8601String(),
                'order' => 'dateCreate', 'orderDirection' => 'asc', 'limit' => 200, 'offset' => $offset]);
            if (! is_array($page['sessions'] ?? null) || ! array_is_list($page['sessions'])
                || ! is_bool($page['hasNextPage'] ?? null) || ($page['hasNextPage'] && ! $page['sessions'])) {
                throw new RuntimeException('Incomplete native session listing.');
            }
            $previous = count($sessions);
            foreach ($page['sessions'] as $s) {
                if ((int) ($s['configId'] ?? 0) !== 1 || (int) ($s['id'] ?? 0) < 1 || (int) ($s['chatId'] ?? 0) < 1
                    || ! is_string($s['dateCreate'] ?? null)) {
                    throw new RuntimeException('Invalid session identity.');
                }
                $opened = CarbonImmutable::parse($s['dateCreate']);
                if ($opened->lt($start) || $opened->gte($end)) {
                    continue;
                }
                $openedAt[(int) $s['id']] = $opened;
                $sessions[(int) $s['id']] = (int) $s['chatId'];
                $chats[(int) $s['chatId']] ??= ['automatic' => false, 'human' => false, 'unattributed' => false];
            }
            if ($page['hasNextPage'] && count($sessions) === $previous) {
                throw new RuntimeException('Session pagination did not advance.');
            }
            $offset += count($page['sessions']);
        } while ($page['hasNextPage']);
        $events = ['automatic' => 0, 'human' => 0, 'unattributed' => 0];
        $actors = $employee = [];
        $nonDistribution = $maintenance = 0;
        foreach (array_chunk(array_keys($sessions), 40) as $ids) {
            $res = $crm->call('imopenlines.v2.Session.Transfer.list', ['sessionId' => $ids]);
            $stats = $crm->call('imopenlines.v2.Session.Stat.get', ['sessionId' => $ids]);
            if (! is_array($res['transfers'] ?? null) || ! array_is_list($res['transfers'])
                || ! is_array($stats['sessions'] ?? null) || ! empty($res['hasNextPage']) || ! empty($res['next'])) {
                throw new RuntimeException('Incomplete native transfer batch.');
            }
            $counts = array_fill_keys($ids, 0);
            foreach ($res['transfers'] as $t) {
                $sid = (int) ($t['sessionId'] ?? 0);
                if (! array_key_exists($sid, $counts) || empty($t['date'])) {
                    throw new RuntimeException('Transfer without a verified session or timestamp.');
                }
                $counts[$sid]++;
                $time = CarbonImmutable::parse($t['date']);
                $limit = $fixedAge ? $openedAt[$sid]->addHours(24) : $end;
                if ($time->lt($openedAt[$sid]) || $time->gte($limit)) {
                    continue;
                }
                if (($t['type'] ?? '') !== 'USER' || (int) ($t['toOperatorId'] ?? 0) < 1
                    || (int) ($t['fromOperatorId'] ?? 0) === (int) $t['toOperatorId']) {
                    $nonDistribution++;

                    continue;
                }
                $initiator = (int) ($t['initiatorId'] ?? 0);
                if ($initiator === 71283 && (int) $t['fromOperatorId'] === 71283 && (int) $t['toOperatorId'] === 57
                    && (self::RESTORATIONS[$sid] ?? null) === [$sessions[$sid], $time->utc()->format('Y-m-d\TH:i:s\Z')]) {
                    $maintenance++;
                    continue;
                }
                if ($initiator > 0 && ! in_array($initiator, [57, 74827, 71283], true) && ! isset($employee[$initiator])) {
                    $users = $crm->call('user.get', ['FILTER' => ['ID' => $initiator]]);
                    $u = $users[0] ?? [];
                    $employee[$initiator] = is_array($users) && count($users) === 1 && (int) ($u['ID'] ?? 0) === $initiator
                        && ($u['USER_TYPE'] ?? '') === 'employee'
                        && ! in_array($u['EXTERNAL_AUTH_ID'] ?? '', ['bot', 'imconnector', 'email', 'replica', 'crm'], true);
                }
                // The owner confirmed 71283 is used only by automations for chat transfers.
                $kind = match (true) {
                    $initiator === 71283 || ($initiator === 0 && ($t['mode'] ?? '') === 'AUTO' && ($t['reason'] ?? '') === 'auto') => 'automatic',
                    in_array($initiator, [57, 74827], true)
                        || (($employee[$initiator] ?? false) && ($t['mode'] ?? '') === 'MANUAL' && ($t['reason'] ?? '') === 'manual') => 'human',
                    default => 'unattributed',
                };
                $events[$kind]++;
                $actors[$initiator] = ($actors[$initiator] ?? 0) + 1;
                $chats[$sessions[$sid]][$kind] = true;
            }
            foreach ($stats['sessions'] as $s) {
                $sid = (int) ($s['sessionId'] ?? 0);
                $count = filter_var($s['transfersCount'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
                if ($count === false || ($counts[$sid] ?? null) !== $count) {
                    throw new RuntimeException('Incomplete native transfer history.');
                }
                unset($counts[$sid]);
            }
            if ($counts !== []) {
                throw new RuntimeException('Missing native session statistics.');
            }
        }
        $groups = array_fill_keys(['only_automatic', 'only_human', 'both', 'attribution_incomplete', 'no_transfer'], 0);
        $human = 0;
        foreach ($chats as $chat) {
            $human += (int) $chat['human'];
            $group = match (true) {
                $chat['unattributed'] => 'attribution_incomplete',
                $chat['human'] && $chat['automatic'] => 'both',
                $chat['automatic'] => 'only_automatic',
                $chat['human'] => 'only_human',
                default => 'no_transfer',
            };
            $groups[$group]++;
        }
        $confirmed = $groups['only_automatic'] + $groups['only_human'] + $groups['both'];
        $this->line(json_encode(['from' => $start->toIso8601String(), 'until_exclusive' => $end->toIso8601String(),
            'transfer_window' => $fixedAge ? 'first_24_hours_per_session' : 'opening_calendar_day',
            'sessions_opened' => count($sessions), 'unique_chats' => count($chats), 'chats_by_distribution' => $groups,
            'chats_with_confirmed_human_work_including_partial' => $human, 'fully_attributed_distributed_chats' => $confirmed,
            'human_work_pct_fully_attributed' => $confirmed ? round(100 * ($groups['only_human'] + $groups['both']) / $confirmed, 1) : null,
            'current_kestra_delivery_requests_for_opened_sessions' => SalesChatTransfer::counts(array_keys($sessions)),
            'technical_restorations' => $maintenance, 'other_native_events' => $nonDistribution, 'native_transfer_counts' => $events, 'events_by_initiator_id' => $actors], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
