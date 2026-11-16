<?php

use App\Services\EdnaBitrix;
use App\Services\WebFormChatGuard;

class WebChatGuardReadFake extends EdnaBitrix
{
    public array $calls = [];

    public array $dialog = ['id' => 601, 'entity_type' => 'LINES', 'entity_id' => 'whatsappbyedna|1|5493510000000@2423|999',
        'entity_data_1' => 'Y|LEAD|700|N|N|501|1794333600|0|0|0', 'owner' => 74827, 'text_field_enabled' => true];

    public array $config = ['ID' => '1', 'QUEUE' => ['74827']];

    public array $session = ['id' => 501, 'chatId' => 601, 'configId' => 1, 'operatorId' => null,
        'status' => 'new', 'dateOperatorAnswer' => null, 'dateFirstAnswer' => null, 'dateClose' => null];

    public array $stats = ['sessionId' => 501, 'messagesOperatorCount' => 0, 'transfersCount' => 0];

    public array $transfers = [];

    public bool $hasNextPage = false;

    public ?Closure $beforeCall = null;

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = [$method, $payload];
        if ($this->beforeCall) {
            ($this->beforeCall)($method, $payload);
        }

        return match ($method) {
            'imopenlines.dialog.get' => $this->dialog,
            'imopenlines.config.get' => $this->config,
            'imopenlines.v2.Session.list' => ['sessions' => [$this->session], 'hasNextPage' => $this->hasNextPage],
            'imopenlines.v2.Session.Stat.get' => ['sessions' => [$this->stats]],
            'imopenlines.v2.Session.Transfer.list' => ['transfers' => $this->transfers],
            default => throw new RuntimeException('Unexpected mutation in read-only ownership guard.'),
        };
    }
}

function webChatGuardProof(): array
{
    return ['verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'chat_id' => '601', 'session_id' => '501'];
}

function inspectWebChatGuard(WebChatGuardReadFake $fake): array
{
    return (new WebFormChatGuard($fake))->inspect(webChatGuardProof(), '90231');
}

test('an unattended current sales queue session is eligible using bounded read-only calls', function () {
    $fake = new WebChatGuardReadFake;
    expect(inspectWebChatGuard($fake))->toMatchArray(['status' => 'ready', 'owner_id' => 74827, 'session_id' => 501])
        ->and($fake->calls)->toHaveCount(8);
    foreach ($fake->calls as [$method, $params]) {
        expect($method)->toBeIn(['imopenlines.dialog.get', 'imopenlines.config.get', 'imopenlines.v2.Session.list',
            'imopenlines.v2.Session.Stat.get', 'imopenlines.v2.Session.Transfer.list']);
        if (in_array($method, ['imopenlines.v2.Session.Stat.get', 'imopenlines.v2.Session.Transfer.list'], true)) {
            expect($params)->toBe(['sessionId' => [501]]);
        }
        if ($method === 'imopenlines.v2.Session.list') {
            expect($params)->toMatchArray(['configId' => 1, 'limit' => 200])
                ->and($params)->not->toHaveKey('chatId');
        }
    }
});

test('unassigned and untouched legacy Maru sessions can be routed', function (int $owner) {
    $fake = new WebChatGuardReadFake;
    $fake->dialog['owner'] = $owner;
    expect(inspectWebChatGuard($fake)['status'])->toBe('ready');
})->with([0, 57]);

test('a current foreign owner is preserved and the requested seller is a no-op', function (int $owner, string $status) {
    $fake = new WebChatGuardReadFake;
    $fake->dialog['owner'] = $owner;
    expect(inspectWebChatGuard($fake)['status'])->toBe($status);
})->with([[29, 'preserved'], [90231, 'already_assigned']]);

test('taking or answering a queue chat is preserved without an owner change', function (string $field) {
    $fake = new WebChatGuardReadFake;
    $fake->session[$field] = '2026-11-10T18:00:01Z';
    expect(inspectWebChatGuard($fake))->toMatchArray(['status' => 'preserved', 'reason' => 'operator_attention_preserved']);
})->with(['dateOperatorAnswer', 'dateFirstAnswer']);

test('operator messages are preserved when answer timestamps lag', function () {
    $fake = new WebChatGuardReadFake;
    $fake->stats['messagesOperatorCount'] = 1;
    expect(inspectWebChatGuard($fake))->toMatchArray(['status' => 'preserved', 'reason' => 'operator_message_preserved']);
});

test('an answered status is preserved even before answer timestamps are populated', function () {
    $fake = new WebChatGuardReadFake;
    $fake->session['status'] = 'answered';
    expect(inspectWebChatGuard($fake))->toMatchArray(['status' => 'preserved', 'reason' => 'session_attention_preserved']);
});

test('an explicit transfer to Nico is preserved including an ambiguous integration initiator', function (int $initiator) {
    $fake = new WebChatGuardReadFake;
    $fake->stats['transfersCount'] = 1;
    $fake->transfers = [['sessionId' => 501, 'type' => 'USER', 'mode' => 'MANUAL', 'initiatorId' => $initiator, 'toOperatorId' => 74827]];
    expect(inspectWebChatGuard($fake))->toMatchArray(['status' => 'preserved', 'reason' => 'explicit_transfer_preserved']);
})->with([57, 74827, 71283]);

test('closed and replaced sessions cannot be routed', function (string $change, string $status) {
    $fake = new WebChatGuardReadFake;
    if ($change === 'disabled') {
        $fake->dialog['text_field_enabled'] = false;
    } else {
        $fake->dialog['entity_data_1'] = str_replace('|501|', $change === 'zero' ? '|0|' : '|502|', $fake->dialog['entity_data_1']);
    }
    expect(inspectWebChatGuard($fake)['status'])->toBe($status);
})->with([['disabled', 'closed'], ['zero', 'closed'], ['reopened', 'replaced']]);

test('a late owner change or replacement is detected by the final dialog read', function (string $change, string $status) {
    $fake = new WebChatGuardReadFake;
    $reads = 0;
    $fake->beforeCall = function ($method) use ($fake, &$reads, $change) {
        if ($method === 'imopenlines.dialog.get' && ++$reads === 2) {
            if ($change === 'owner') {
                $fake->dialog['owner'] = 29;
            } else {
                $fake->dialog['entity_data_1'] = str_replace('|501|', '|502|', $fake->dialog['entity_data_1']);
            }
        }
    };
    expect(inspectWebChatGuard($fake)['status'])->toBe($status);
})->with([['owner', 'preserved'], ['session', 'replaced']]);

test('a late acceptance with unchanged owner is detected by a repeated exact session read', function () {
    $fake = new WebChatGuardReadFake;
    $reads = 0;
    $fake->beforeCall = function ($method) use ($fake, &$reads) {
        if ($method === 'imopenlines.v2.Session.list' && ++$reads === 2) {
            $fake->session['dateOperatorAnswer'] = '2026-11-10T18:00:02Z';
        }
    };
    expect(inspectWebChatGuard($fake))->toMatchArray(['status' => 'preserved', 'reason' => 'operator_attention_preserved']);
});

test('a late transfer to the same owner is detected by repeated transfer history', function () {
    $fake = new WebChatGuardReadFake;
    $reads = 0;
    $fake->beforeCall = function ($method) use ($fake, &$reads) {
        if ($method === 'imopenlines.v2.Session.Transfer.list' && ++$reads === 2) {
            $fake->transfers = [['sessionId' => 501, 'type' => 'USER', 'mode' => 'MANUAL', 'initiatorId' => 57, 'toOperatorId' => 74827]];
        }
    };
    expect(inspectWebChatGuard($fake))->toMatchArray(['status' => 'preserved', 'reason' => 'explicit_transfer_preserved']);
});

test('incomplete or mismatched metadata fails closed without ownership changes', function (string $change) {
    $fake = new WebChatGuardReadFake;
    match ($change) {
        'page' => $fake->hasNextPage = true,
        'wrong_session' => $fake->session['id'] = 502,
        'missing_answer' => $fake->session = array_diff_key($fake->session, ['dateOperatorAnswer' => true]),
        'missing_operator' => $fake->session = array_diff_key($fake->session, ['operatorId' => true]),
        'missing_stats' => $fake->stats = [],
        'missing_transfers' => $fake->stats['transfersCount'] = 1,
        'wrong_line' => $fake->dialog['entity_id'] = 'whatsappbyedna|3|fixture|fixture',
    };
    expect(inspectWebChatGuard($fake))->toMatchArray(['status' => 'waiting', 'reason' => 'ownership_inspection_unavailable']);
})->with(['page', 'wrong_session', 'missing_answer', 'missing_operator', 'missing_stats', 'missing_transfers', 'wrong_line']);

test('inspection failures do not expose credential-bearing exception details', function () {
    $fake = new WebChatGuardReadFake;
    $fake->beforeCall = fn () => throw new RuntimeException('https://private.invalid/rest/1/secretcredential');
    $result = inspectWebChatGuard($fake);
    expect($result['status'])->toBe('waiting')->and(json_encode($result))->not->toContain('secretcredential', 'private.invalid');
});
