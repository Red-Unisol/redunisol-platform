<?php

use App\Services\EdnaBitrix;
use App\Services\EdnaRejectedChatGuard;

class RejectedChatReadFake extends EdnaBitrix
{
    public array $calls = [];

    public array $dialog = ['id' => 601, 'entity_type' => 'LINES',
        'entity_id' => 'whatsappbyedna|1|5493510000000@2423|999',
        'entity_data_1' => 'Y|LEAD|700|N|N|501|1794333600|0|0|0',
        'entity_data_2' => 'LEAD|700|CONTACT|0|DEAL|0', 'owner' => 74827, 'text_field_enabled' => true];

    public array $session = ['id' => 501, 'chatId' => 601, 'configId' => 1, 'operatorId' => null,
        'dateCreate' => '2026-11-10T18:00:00Z', 'status' => 'new',
        'dateOperatorAnswer' => null, 'dateFirstAnswer' => null, 'dateClose' => null];

    public array $stats = ['sessionId' => 501, 'messagesOperatorCount' => 1, 'transfersCount' => 0];

    public array $transfers = [];

    public array $history = ['sessionId' => 501, 'chatId' => 601, 'hasNextPage' => false,
        'message' => [
            ['id' => 700, 'chatid' => 601, 'senderid' => 999, 'date' => '2026-11-10T18:00:01Z', 'text' => 'Synthetic client request'],
            ['id' => 701, 'chatid' => 601, 'senderid' => 74827, 'date' => '2026-11-10T18:01:00Z',
                'text' => "Synthetic rejection notice\r\n", 'params' => ['class' => 'bx-messenger-content-item-ol-output', 'connectorMid' => ['notice-mid-1']]],
        ], 'users' => [999 => ['connector' => true], 74827 => ['connector' => false, 'bot' => false]],
    ];

    public bool $sessionHasNextPage = false;

    public ?Closure $beforeCall = null;

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = [$method, $payload];
        if ($this->beforeCall) {
            ($this->beforeCall)($method, $payload);
        }

        return match ($method) {
            'imopenlines.dialog.get' => $this->dialog,
            'imopenlines.v2.Session.list' => ['sessions' => [$this->session], 'hasNextPage' => $this->sessionHasNextPage],
            'imopenlines.v2.Session.Stat.get' => ['sessions' => [$this->stats]],
            'imopenlines.v2.Session.Transfer.list' => ['transfers' => $this->transfers],
            'imopenlines.session.history.get' => $this->history,
            default => throw new RuntimeException('Unexpected write in rejection guard.'),
        };
    }
}

function rejectedChatProof(): array
{
    return ['verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'chat_id' => '601', 'session_id' => '501'];
}

function rejectedChatNotice(): array
{
    return ['message_id' => 701, 'date' => '2026-11-10T18:01:00Z', 'sender_id' => 74827,
        'template_sha256' => hash('sha256', "Synthetic rejection notice\n"),
        'native_text_sha256' => hash('sha256', "Synthetic rejection notice\r\n"), 'connector_mid' => 'notice-mid-1'];
}

function inspectRejectedChat(RejectedChatReadFake $fake): array
{
    return (new EdnaRejectedChatGuard($fake))->inspect(rejectedChatProof(), rejectedChatNotice());
}

test('only the exact registered notice is exempted in an untouched current sales session', function (int $operatorCount, int $owner) {
    $fake = new RejectedChatReadFake;
    $fake->stats['messagesOperatorCount'] = $operatorCount;
    $fake->dialog['owner'] = $owner;
    $result = inspectRejectedChat($fake);
    expect($result)->toMatchArray(['status' => 'ready', 'owner_id' => $owner, 'session_id' => 501,
        'session_created_at' => '2026-11-10T18:00:00Z', 'dialog' => $fake->dialog])
        ->and($fake->calls)->toHaveCount(10);
    foreach ($fake->calls as [$method, $params]) {
        expect($method)->toBeIn(['imopenlines.dialog.get', 'imopenlines.v2.Session.list',
            'imopenlines.v2.Session.Stat.get', 'imopenlines.v2.Session.Transfer.list', 'imopenlines.session.history.get']);
        if (in_array($method, ['imopenlines.v2.Session.Stat.get', 'imopenlines.v2.Session.Transfer.list'], true)) {
            expect($params)->toBe(['sessionId' => [501]]);
        }
        if ($method === 'imopenlines.v2.Session.list') {
            expect($params)->not->toHaveKey('chatId');
        }
    }
})->with([[0, 0], [1, 57], [1, 74827]]);

test('normalization of the approved template does not weaken the raw native fingerprint', function () {
    $notice = rejectedChatNotice();
    expect($notice['template_sha256'])->not->toBe($notice['native_text_sha256'])
        ->and(inspectRejectedChat(new RejectedChatReadFake)['status'])->toBe('ready');
});

test('notice proof permits another known employee only for the exact registered message', function () {
    $fake = new RejectedChatReadFake;
    $fake->history['message'][1]['senderid'] = 57;
    $fake->history['users'][57] = ['connector' => false];
    $notice = rejectedChatNotice();
    $notice['sender_id'] = 57;
    expect((new EdnaRejectedChatGuard($fake))->inspect(rejectedChatProof(), $notice)['status'])->toBe('ready');
});

test('taking or answering a chat is preserved even when its owner remains Nico', function (string $field) {
    $fake = new RejectedChatReadFake;
    $fake->session[$field] = '2026-11-10T18:00:30Z';
    expect(inspectRejectedChat($fake))->toMatchArray(['status' => 'preserved', 'reason' => 'operator_attention_preserved']);
})->with(['dateOperatorAnswer', 'dateFirstAnswer']);

test('an accepted status or actual foreign operator is preserved before answer timestamps catch up', function (string $change) {
    $fake = new RejectedChatReadFake;
    if ($change === 'status') {
        $fake->session['status'] = 'answered';
    } else {
        $fake->session['operatorId'] = 90231;
    }
    expect(inspectRejectedChat($fake)['status'])->toBe('preserved');
})->with(['status', 'operator']);

test('any explicit user transfer is preserved including a manual return to Maru', function (int $actor) {
    $fake = new RejectedChatReadFake;
    $fake->dialog['owner'] = 57;
    $fake->stats['transfersCount'] = 1;
    $fake->transfers = [['sessionId' => 501, 'type' => 'USER', 'mode' => 'MANUAL', 'initiatorId' => $actor, 'toOperatorId' => 57]];
    expect(inspectRejectedChat($fake))->toMatchArray(['status' => 'preserved', 'reason' => 'explicit_transfer_preserved']);
})->with([74827, 71283]);

test('an automatic queue offer is not mistaken for human intervention', function () {
    $fake = new RejectedChatReadFake;
    $fake->stats['transfersCount'] = 1;
    $fake->transfers = [['sessionId' => 501, 'type' => 'QUEUE', 'mode' => 'AUTO']];
    expect(inspectRejectedChat($fake)['status'])->toBe('ready');
});

test('a foreign dialog owner is preserved without an already assigned shortcut', function () {
    $fake = new RejectedChatReadFake;
    $fake->dialog['owner'] = 90231;
    expect(inspectRejectedChat($fake))->toMatchArray(['status' => 'preserved', 'reason' => 'chat_owner_preserved']);
});

test('closed and reopened sessions cannot be closed through the old proof', function (string $change, string $status) {
    $fake = new RejectedChatReadFake;
    match ($change) {
        'disabled' => $fake->dialog['text_field_enabled'] = false,
        'zero' => $fake->dialog['entity_data_1'] = 'Y|LEAD|700|N|N|0|0|0|0|0',
        'reopened' => $fake->dialog['entity_data_1'] = str_replace('|501|', '|502|', $fake->dialog['entity_data_1']),
        'session_closed' => $fake->session['dateClose'] = '2026-11-10T18:02:00Z',
    };
    expect(inspectRejectedChat($fake)['status'])->toBe($status);
})->with([['disabled', 'closed'], ['zero', 'closed'], ['reopened', 'replaced'], ['session_closed', 'closed']]);

test('a fresh client message after the notice is preserved by timestamp or native ordering', function (string $at, int $id) {
    $fake = new RejectedChatReadFake;
    $fake->history['message'][] = ['id' => $id, 'chatid' => 601, 'senderid' => 999, 'date' => $at, 'text' => 'Synthetic follow up'];
    expect(inspectRejectedChat($fake))->toMatchArray(['status' => 'preserved', 'reason' => 'client_reply_after_notice_preserved']);
})->with([['2026-11-10T18:02:00Z', 702], ['2026-11-10T18:01:00Z', 702], ['2026-11-10T18:02:00Z', 699]]);

test('any other operator message is preserved even before the notice with lagging statistics', function (string $at) {
    $fake = new RejectedChatReadFake;
    $fake->stats['messagesOperatorCount'] = 0;
    $fake->history['message'][] = ['id' => 702, 'chatid' => 601, 'senderid' => 74827, 'date' => $at, 'text' => 'Synthetic human answer'];
    expect(inspectRejectedChat($fake))->toMatchArray(['status' => 'preserved', 'reason' => 'operator_message_preserved']);
})->with(['2026-11-10T18:00:30Z', '2026-11-10T18:02:00Z']);

test('statistics reporting more than the one known notice preserve attention', function () {
    $fake = new RejectedChatReadFake;
    $fake->stats['messagesOperatorCount'] = 2;
    expect(inspectRejectedChat($fake))->toMatchArray(['status' => 'preserved', 'reason' => 'operator_message_preserved']);
});

test('a late acceptance reply or transfer without any owner change is detected', function (string $change) {
    $fake = new RejectedChatReadFake;
    $reads = 0;
    $target = match ($change) {
        'accepted' => 'imopenlines.v2.Session.list',
        'transfer' => 'imopenlines.v2.Session.Transfer.list',
        'reply' => 'imopenlines.session.history.get',
    };
    $fake->beforeCall = function ($method) use ($fake, &$reads, $target, $change) {
        if ($method !== $target || ++$reads !== 2) {
            return;
        }
        match ($change) {
            'accepted' => $fake->session['dateOperatorAnswer'] = '2026-11-10T18:02:00Z',
            'transfer' => $fake->transfers[] = ['sessionId' => 501, 'type' => 'USER', 'mode' => 'MANUAL'],
            'reply' => $fake->history['message'][] = ['id' => 702, 'chatid' => 601, 'senderid' => 999, 'date' => '2026-11-10T18:02:00Z'],
        };
    };
    expect(inspectRejectedChat($fake)['status'])->toBe('preserved');
})->with(['accepted', 'transfer', 'reply']);

test('final dialog reread catches owner session closure and CRM identity drift', function (string $change, string $status) {
    $fake = new RejectedChatReadFake;
    $reads = 0;
    $fake->beforeCall = function ($method) use ($fake, &$reads, $change) {
        if ($method !== 'imopenlines.dialog.get' || ++$reads !== 2) {
            return;
        }
        match ($change) {
            'owner' => $fake->dialog['owner'] = 57,
            'session' => $fake->dialog['entity_data_1'] = str_replace('|501|', '|502|', $fake->dialog['entity_data_1']),
            'closed' => $fake->dialog['text_field_enabled'] = false,
            'lead' => $fake->dialog['entity_data_1'] = str_replace('|LEAD|700|', '|LEAD|701|', $fake->dialog['entity_data_1']),
            'crm' => $fake->dialog['entity_data_2'] = 'LEAD|701|CONTACT|0|DEAL|0',
            'identity' => $fake->dialog['entity_id'] = 'whatsappbyedna|1|5493510000001@2423|999',
        };
    };
    expect(inspectRejectedChat($fake)['status'])->toBe($status);
})->with([['owner', 'preserved'], ['session', 'replaced'], ['closed', 'closed'],
    ['lead', 'preserved'], ['crm', 'preserved'], ['identity', 'preserved']]);

test('the exact native notice cannot be replaced by a similarly classified outgoing message', function (string $change) {
    $fake = new RejectedChatReadFake;
    match ($change) {
        'id' => $fake->history['message'][1]['id'] = 702,
        'date' => $fake->history['message'][1]['date'] = '2026-11-10T18:01:01Z',
        'sender' => $fake->history['message'][1]['senderid'] = 999,
        'raw_text' => $fake->history['message'][1]['text'] = "Synthetic rejection notice\n",
        'class' => $fake->history['message'][1]['params']['class'] = 'other-output',
        'mid' => $fake->history['message'][1]['params']['connectorMid'] = ['unrelated-mid'],
        'user' => $fake->history['users'][74827]['connector'] = true,
    };
    expect(inspectRejectedChat($fake)['status'])->toBe('waiting');
})->with(['id', 'date', 'sender', 'raw_text', 'class', 'mid', 'user']);

test('missing malformed or paginated evidence always fails closed', function (string $change) {
    $fake = new RejectedChatReadFake;
    match ($change) {
        'wrong_line' => $fake->dialog['entity_id'] = 'whatsappbyedna|2|fixture|999',
        'session_page' => $fake->sessionHasNextPage = true,
        'session_mismatch' => $fake->session['id'] = 502,
        'session_time' => $fake->session['dateCreate'] = '2026-11-10T18:00:03Z',
        'missing_status' => $fake->session = array_diff_key($fake->session, ['status' => true]),
        'null_status' => $fake->session['status'] = null,
        'missing_answer' => $fake->session = array_diff_key($fake->session, ['dateOperatorAnswer' => true]),
        'missing_operator' => $fake->session = array_diff_key($fake->session, ['operatorId' => true]),
        'missing_count' => $fake->stats = [],
        'bad_count' => $fake->stats['messagesOperatorCount'] = true,
        'missing_transfer' => $fake->stats['transfersCount'] = 1,
        'unknown_transfer' => $fake->transfers[] = ['sessionId' => 501, 'type' => 'UNKNOWN', 'mode' => 'AUTO'],
        'history_page' => $fake->history['hasNextPage'] = true,
        'missing_history_page' => $fake->history = array_diff_key($fake->history, ['hasNextPage' => true]),
        'tariff' => $fake->history['tariffRestrictions'] = ['isHistoryLimitExceeded' => true],
        'history_session' => $fake->history['sessionId'] = 502,
        'history_chat' => $fake->history['chatId'] = 602,
        'message_chat' => $fake->history['message'][0]['chatid'] = 602,
        'duplicate_message' => $fake->history['message'][] = $fake->history['message'][1],
        'unknown_user' => $fake->history['users'] = array_diff_key($fake->history['users'], [999 => true]),
        'unknown_connector' => $fake->history['users'][999]['connector'] = 'Y',
        'missing_notice' => $fake->history['message'] = [$fake->history['message'][0]],
        'contradictory_zero' => $fake->history['message'][] = ['id' => 699, 'chatid' => 601, 'senderid' => 0, 'date' => '2026-11-10T18:00:00Z', 'system' => false],
    };
    expect(inspectRejectedChat($fake))->toMatchArray(['status' => 'waiting', 'reason' => 'rejected_session_inspection_unavailable']);
})->with(['wrong_line', 'session_page', 'session_mismatch', 'session_time', 'missing_status', 'null_status',
    'missing_answer', 'missing_operator', 'missing_count', 'bad_count', 'missing_transfer', 'unknown_transfer',
    'history_page', 'missing_history_page', 'tariff', 'history_session', 'history_chat', 'message_chat',
    'duplicate_message', 'unknown_user', 'unknown_connector', 'missing_notice', 'contradictory_zero']);

test('explicit native system messages are classified without exempting an unknown sender', function () {
    $fake = new RejectedChatReadFake;
    $fake->history['message'][] = ['id' => 699, 'chatid' => 601, 'senderid' => 0, 'date' => '2026-11-10T18:00:00Z', 'system' => true];
    expect(inspectRejectedChat($fake)['status'])->toBe('ready');
});

test('native history reserved sender zero works without the absent system flag and user record', function (bool $withUser) {
    $fake = new RejectedChatReadFake;
    // Same native shape observed on session318043: arrays/maps, reserved sender
    // zero, no system flag and internal start/attach messages with no user0.
    $fake->history['message'] = array_combine([700, 701], $fake->history['message']);
    $fake->history['message'][698] = ['id' => '698', 'chatid' => '601', 'senderid' => '0',
        'date' => '2026-11-10T18:00:00Z', 'params' => ['class' => 'bx-messenger-content-item-ol-start', 'componentId' => 'StartSession']];
    $fake->history['message'][699] = ['id' => '699', 'chatid' => '601', 'senderid' => '0',
        'date' => '2026-11-10T18:00:00Z', 'system' => null, 'params' => ['attach' => []]];
    $fake->history['message'][697] = ['id' => '697', 'chatid' => '601', 'senderid' => '0',
        'date' => '2026-11-10T18:00:00Z', 'params' => []];
    if ($withUser) {
        $fake->history['users'][0] = ['connector' => false];
    }
    expect(inspectRejectedChat($fake)['status'])->toBe('ready');
})->with([false, true]);

test('reserved sender zero cannot conceal connector or outgoing evidence', function (string $change) {
    $fake = new RejectedChatReadFake;
    $fake->history['message'][] = ['id' => 699, 'chatid' => 601, 'senderid' => 0,
        'date' => '2026-11-10T18:00:00Z', 'params' => []];
    $last = array_key_last($fake->history['message']);
    match ($change) {
        'connector' => $fake->history['users'][0] = ['connector' => true],
        'unknown_user' => $fake->history['users'][0] = [],
        'null_user' => $fake->history['users'][0] = null,
        'mid' => $fake->history['message'][$last]['params']['connectorMid'] = ['unexpected-mid'],
        'upper_mid' => $fake->history['message'][$last]['params']['CONNECTOR_MID'] = ['unexpected-mid'],
        'output' => $fake->history['message'][$last]['params']['class'] = 'bx-messenger-content-item-ol-output',
    };
    expect(inspectRejectedChat($fake)['status'])->toBe('waiting');
})->with(['connector', 'unknown_user', 'null_user', 'mid', 'upper_mid', 'output']);

test('reserved sender zero exception never bypasses a later client reply or lagging human attention', function (string $change) {
    $fake = new RejectedChatReadFake;
    $fake->history['message'][] = ['id' => 699, 'chatid' => 601, 'senderid' => 0,
        'date' => '2026-11-10T18:00:00Z', 'params' => []];
    match ($change) {
        'reply' => $fake->history['message'][] = ['id' => 702, 'chatid' => 601, 'senderid' => 999, 'date' => '2026-11-10T18:02:00Z'],
        'operator' => $fake->stats['messagesOperatorCount'] = 2,
        'accepted' => $fake->session['dateOperatorAnswer'] = '2026-11-10T18:00:30Z',
        'transfer' => $fake->transfers[] = ['sessionId' => 501, 'type' => 'USER', 'mode' => 'MANUAL'],
    };
    expect(inspectRejectedChat($fake)['status'])->toBe('preserved');
})->with(['reply', 'operator', 'accepted', 'transfer']);

test('invalid notice and native proof do not make provider reads', function (string $change) {
    $fake = new RejectedChatReadFake;
    $proof = rejectedChatProof();
    $notice = rejectedChatNotice();
    match ($change) {
        'proof' => $proof['verified'] = false,
        'notice' => $notice['native_text_sha256'] = 'bad',
        'mid' => $notice['connector_mid'] = '',
        'zero_sender' => $notice['sender_id'] = 0,
    };
    expect((new EdnaRejectedChatGuard($fake))->inspect($proof, $notice)['status'])->toBe('waiting')
        ->and($fake->calls)->toBeEmpty();
})->with(['proof', 'notice', 'mid', 'zero_sender']);

test('API failures retain no credential-bearing exception text', function () {
    $fake = new RejectedChatReadFake;
    $fake->beforeCall = fn () => throw new RuntimeException('https://private.invalid/rest/1/secretcredential');
    $result = inspectRejectedChat($fake);
    expect($result['status'])->toBe('waiting')->and(json_encode($result))->not->toContain('secretcredential', 'private.invalid');
});
