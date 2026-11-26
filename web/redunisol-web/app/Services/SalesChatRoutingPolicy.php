<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/** Shared boundary for automated Benefits and reopened-loan chat handoffs on VENTAS. */
class SalesChatRoutingPolicy
{
    public const CUTOVER = 'sales-chat-routing-v1';

    public function eligible(object $entry): bool
    {
        return app(EdnaFreshIntake::class)->entry($entry, self::CUTOVER);
    }

    public function newSession(string $openedAt): bool
    {
        $cut = DB::table('edna_intake_cutovers')->where('name', self::CUTOVER)->value('starts_at');

        return $cut !== null && $openedAt !== '' && CarbonImmutable::parse($openedAt)->gte(CarbonImmutable::parse($cut));
    }

    public function commercialTarget(mixed $id): bool
    {
        return (is_int($id) || is_string($id)) && preg_match('/^[1-9][0-9]*$/D', (string) $id)
            && ! in_array((string) $id, ['57', '74827', '71283'], true);
    }

    public function assertTransferIsolation(): void
    {
        $line = app(EdnaBitrix::class)->call('imopenlines.config.get', ['CONFIG_ID' => 1]);
        if ((string) ($line['ID'] ?? '') !== '1' || ($line['CRM_TRANSFER_CHANGE'] ?? '') !== 'N') {
            throw new RuntimeException('Sales chat transfers are not isolated from CRM ownership.');
        }
    }

    public function inspectBeforeHandoff(WebFormChatGuard $guard, array $proof, string $target): array
    {
        $this->assertTransferIsolation();

        return $guard->inspect($proof, $target);
    }

    /** Called under the shared chat lock, in the same transaction as the provider intent. */
    public function reserveHandoff(array $proof, string $family, int $target): bool
    {
        if (! in_array($family, ['benefits', 'reopening'], true) || ! $this->commercialTarget($target)
            || ($proof['verified'] ?? null) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session'
            || ($proof['evidence'] ?? '') !== 'external_message_id' || DB::transactionLevel() === 0) {
            throw new RuntimeException('Invalid sales chat routing reservation.');
        }
        foreach (['chat_id', 'session_id', 'entry_event_id', 'message_id'] as $field) {
            if (! preg_match('/^[1-9][0-9]*$/D', (string) ($proof[$field] ?? ''))) {
                throw new RuntimeException('Incomplete native handoff evidence.');
            }
        }

        return DB::table('edna_sales_chat_handoffs')->insertOrIgnore([
            'chat_id' => $proof['chat_id'], 'session_id' => $proof['session_id'], 'entry_event_id' => $proof['entry_event_id'],
            'native_message_id' => $proof['message_id'], 'target_id' => $target, 'family' => $family, 'created_at' => now(),
        ]) === 1;
    }

    /** Only the one native session and target from the committed intent may be posted. */
    public function postReserved(EdnaBitrix $crm, array $proof, string $family, int $target): bool
    {
        $claimed = DB::table('edna_sales_chat_handoffs')->where([
            'chat_id' => $proof['chat_id'], 'session_id' => $proof['session_id'], 'entry_event_id' => $proof['entry_event_id'],
            'native_message_id' => $proof['message_id'], 'family' => $family, 'target_id' => $target,
        ])->whereNull('post_started_at')->update(['post_started_at' => now()]);
        if ($claimed !== 1) {
            throw new RuntimeException('Handoff already attempted or reservation changed.');
        }

        return $crm->call('imopenlines.operator.transfer', ['CHAT_ID' => (int) $proof['chat_id'], 'USER_ID' => $target]) === true;
    }
}
