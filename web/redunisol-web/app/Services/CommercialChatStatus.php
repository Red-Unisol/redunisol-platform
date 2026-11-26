<?php

namespace App\Services;

use App\Models\BitrixRoutingAllocation;
use App\Models\BitrixRoutingSeller;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/** On-demand, read-only evidence for a single sales session. */
class CommercialChatStatus
{
    public function __construct(private EdnaBitrix $crm) {}

    public function lookup(int $chatId): array
    {
        $current = (new WebFormChatGuard($this->crm))->currentSession($chatId);
        $session = $current['session'];
        if (! $session) {
            return ['chat' => $chatId, 'session' => null];
        }
        $sessionId = (int) $session['id'];
        $names = BitrixRoutingSeller::query()->pluck('name', 'bitrix_user_id')->all()
            + [74827 => 'Nico Sallitto', 57 => 'Maru', 71283 => 'Santiago Acosta'];
        $operator = fn (int $id): string => ($names[$id] ?? 'Usuario Bitrix').' (#'.$id.')';
        $owner = (int) $current['owner'];
        $inbox = $owner ? $operator($owner) : 'Sin operador asignado';

        $result = ['chat' => $chatId, 'session' => $sessionId, 'open' => $current['open'],
            'inbox' => $owner === 74827 ? $inbox.' · bandeja de distribución' : $inbox];
        try {
            $result['selections'] = $this->selections($chatId, $sessionId, $operator);
        } catch (Throwable) {
            $result['selections'] = null;
        }
        try {
            $result['transfers'] = $this->transfers($chatId, $sessionId, $operator);
        } catch (Throwable) {
            $result['transfers'] = null;
        }

        // A current owner, an outbound template and a pass by Nico do not prove anyone took the chat.
        $accepted = $this->date($session['dateOperatorAnswer'] ?? null);
        $result['attention'] = match (true) {
            $accepted !== null && (int) ($session['operatorId'] ?? 0) > 0 && (int) $session['operatorId'] !== 71283 =>
                'Toma registrada por Bitrix el '.$accepted.'.',
            ! array_key_exists('dateOperatorAnswer', $session) || ! empty($session['dateOperatorAnswer'])
                || ! empty($session['dateFirstAnswer']) => 'Sin evidencia suficiente para confirmar atención humana.',
            default => 'Sin toma de operador registrada.',
        };

        return $result;
    }

    private function selections(int $chatId, int $sessionId, callable $operator): array
    {
        $selections = [];
        $add = function (string $source, mixed $id, mixed $seller, mixed $deal) use (&$selections): void {
            $selections[] = ['source' => $source.' '.$id, 'seller' => (int) $seller ?: null, 'deal' => (int) $deal ?: null];
        };
        $web = DB::table('web_form_chat_routes')->where('proof->chat_id', (string) $chatId)
            ->where('proof->session_id', (string) $sessionId)->whereNotNull('submission_id')
            ->get(['submission_id', 'seller_id', 'deal_id', 'entry_event_id', 'proof']);
        foreach ($web as $row) {
            if ((new WebFormChatRouting)->validHistory($row)) {
                $add('Formulario web', $row->submission_id, $row->seller_id, $row->deal_id);
            }
        }

        // The original receipt stores its proof as TEXT, whereas web receipts use a JSON column.
        $intakes = DB::table('edna_intake_chat_routes');
        if (DB::getDriverName() === 'pgsql') {
            $intakes->whereRaw("(CAST(proof AS jsonb)->>'chat_id') = ? AND (CAST(proof AS jsonb)->>'session_id') = ?", [(string) $chatId, (string) $sessionId]);
        } else {
            $intakes->where('proof->chat_id', (string) $chatId)->where('proof->session_id', (string) $sessionId);
        }
        foreach ($intakes->get(['request_id', 'assigned_case', 'transfer_intent', 'proof']) as $row) {
            $proof = json_decode($row->proof, true, 32, JSON_THROW_ON_ERROR);
            if (($proof['verified'] ?? false) !== true || ($proof['evidence'] ?? '') !== 'external_message_id') {
                continue;
            }
            $case = json_decode($row->assigned_case, true, 32, JSON_THROW_ON_ERROR);
            $intent = json_decode($row->transfer_intent ?? '{}', true, 32, JSON_THROW_ON_ERROR);
            $selection = $intent['commercial_case'] ?? $case;
            if (isset($case['request_uuid']) && ! isset($selection['seller_id'])) {
                $selection = (new EdnaFreshCaseRoute)->target($case, $this->crm);
            }
            $add('WhatsApp v3 #', $row->request_id, $selection['seller_id'] ?? $case['seller_id'] ?? null,
                $selection['deal_id'] ?? $case['deal_id'] ?? null);
        }
        // A second inbound in the same session may point to a canonical menu
        // while the exact new message and its seller live on the handoff receipt.
        $reopening = DB::table('edna_sales_chat_handoffs as h')
            ->leftJoin('edna_organic_menus as m', 'm.entry_event_id', '=', 'h.entry_event_id')
            ->where('h.chat_id', $chatId)->where('h.session_id', $sessionId)->where('h.family', 'reopening')
            ->first(['h.entry_event_id', 'h.target_id', 'm.seller_id', 'm.deal_id']);
        if ($reopening) {
            $deal = (string) $reopening->seller_id === (string) $reopening->target_id ? $reopening->deal_id : null;
            $add('Reapertura · ingreso #', $reopening->entry_event_id, $reopening->target_id, $deal);
        }
        foreach (DB::table('edna_organic_menus')->where('chat_id', $chatId)->where('session_id', $sessionId)
            ->when($reopening, fn ($query) => $query->where('entry_event_id', '!=', $reopening->entry_event_id))
            ->get(['id', 'seller_id', 'deal_id']) as $menu) {
            if ($menu->seller_id) {
                $add('Menú #', $menu->id, $menu->seller_id, $menu->deal_id);
            }
        }
        foreach (DB::table('edna_benefit_chat_routes')->where('chat_id', $chatId)->where('session_id', $sessionId)
            ->get(['entry_event_id', 'target_id', 'deal_id']) as $benefits) {
            $add('Beneficios #', $benefits->entry_event_id, $benefits->target_id, $benefits->deal_id);
        }

        $allocated = BitrixRoutingAllocation::query()->where('scope', config('chat_response.scope'))
            ->whereIn('deal_id', array_filter(array_column($selections, 'deal')))->pluck('assigned_user_id', 'deal_id');
        foreach ($selections as &$selection) {
            $id = $selection['seller'] ?? $allocated->get($selection['deal']);
            $selection['seller'] = $id ? $operator((int) $id) : null;
        }
        unset($selection);

        return array_values(array_unique($selections, SORT_REGULAR));
    }

    private function transfers(int $chatId, int $sessionId, callable $operator): array
    {
        $filter = ['sessionId' => [$sessionId]];
        $stats = $this->crm->call('imopenlines.v2.Session.Stat.get', $filter)['sessions'] ?? null;
        $data = $this->crm->call('imopenlines.v2.Session.Transfer.list', $filter);
        $rows = $data['transfers'] ?? null;
        if (! is_array($stats) || count($stats) !== 1 || (int) ($stats[0]['sessionId'] ?? 0) !== $sessionId
            || ! ctype_digit((string) ($stats[0]['transfersCount'] ?? '')) || ! is_array($rows) || ! array_is_list($rows)
            || count($rows) < (int) $stats[0]['transfersCount'] || ($data['hasNextPage'] ?? false) !== false) {
            throw new RuntimeException('Incomplete transfer record.');
        }
        $events = [];
        $seen = [];
        foreach ($rows as $row) {
            if ((int) ($row['sessionId'] ?? 0) !== $sessionId || (int) ($row['chatId'] ?? $chatId) !== $chatId) {
                throw new RuntimeException('Unexpected transfer identity.');
            }
            $signature = json_encode(array_map(fn ($field) => (string) ($row[$field] ?? ''),
                ['sessionId', 'type', 'mode', 'fromOperatorId', 'toOperatorId', 'fromConfigId', 'toConfigId', 'initiatorId', 'date']), JSON_THROW_ON_ERROR);
            $key = isset($row['id']) ? 'id:'.$row['id'] : $signature;
            if (isset($seen[$key]) && $seen[$key] !== $signature) {
                throw new RuntimeException('Contradictory transfer record.');
            }
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = $signature;
            if (($row['type'] ?? '') === 'QUEUE' && ($row['mode'] ?? '') === 'AUTO') {
                continue;
            }
            $target = (int) ($row['toOperatorId'] ?? 0);
            $at = $this->date($row['date'] ?? null);
            if (($row['type'] ?? '') !== 'USER' || $target < 1 || ! $at) {
                throw new RuntimeException('Unclassified native transfer.');
            }
            $actor = (int) ($row['initiatorId'] ?? 0);
            $origin = match (true) {
                $actor === 71283 => 'Automática · cuenta de integración',
                ($row['mode'] ?? '') === 'AUTO' => 'Automática · Bitrix',
                ($row['mode'] ?? '') === 'MANUAL' && in_array($actor, [57, 74827], true) => 'Manual · '.$operator($actor),
                $actor > 0 => 'Iniciador · '.$operator($actor),
                default => 'Origen sin verificar',
            };
            $events[] = ['date' => $at, 'target' => $operator($target), 'origin' => $origin, 'instant' => $row['date']];
        }
        if (count($seen) < (int) $stats[0]['transfersCount']) {
            throw new RuntimeException('Missing native transfer.');
        }
        usort($events, fn ($a, $b) => strtotime($a['instant']) <=> strtotime($b['instant']));

        return $events;
    }

    private function date(mixed $value): ?string
    {
        if (! is_string($value) || ! preg_match('/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/D', $value)) {
            return null;
        }

        return CarbonImmutable::parse($value)->tz('America/Argentina/Buenos_Aires')->format('d/m/Y H:i:s').' ART';
    }
}
