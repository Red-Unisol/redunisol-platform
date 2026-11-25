<?php

use App\Services\EdnaBitrix;
use App\Services\EdnaMessageBinding;
use Illuminate\Support\Facades\Crypt;
use Tests\TestCase;

uses(TestCase::class);

beforeEach(function () {
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('c', 32)));
    config()->set('edna.subject_id', '2423');
});

class CurrentMessageReadFake extends EdnaBitrix
{
    public array $calls = [];

    public array $ids = ['LEAD' => ['101'], 'CONTACT' => []];

    public array $records = [];

    public array $chats = [];

    public array $activities = [];

    public array $histories = [];

    public array $chatHistories = [];

    public array $pages = [];

    public array $dialogs = [];

    public array $deals = [];

    public ?Closure $afterRead = null;

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = [$method, $payload];
        $result = match ($method) {
            'crm.duplicate.findbycomm' => [$payload['entity_type'] => $this->ids[$payload['entity_type']]],
            'crm.lead.list' => $this->records['LEAD'],
            'crm.contact.list' => $this->records['CONTACT'],
            'crm.deal.list' => $this->deals,
            'imopenlines.crm.chat.get' => $this->chats[$payload['CRM_ENTITY_TYPE'].':'.$payload['CRM_ENTITY']] ?? [],
            'imopenlines.dialog.get' => $this->dialogs[(string) $payload['CHAT_ID']] ?? [],
            'crm.activity.list' => isset($payload['filter']['ASSOCIATED_ENTITY_ID'])
                ? $this->activities[(string) $payload['filter']['ASSOCIATED_ENTITY_ID']] ?? []
                : throw new RuntimeException('Current discovery must not read historical owner activities.'),
            'imopenlines.session.history.get' => isset($payload['CHAT_ID'])
                ? ($this->chatHistories[$payload['CHAT_ID']] ?? [])
                : (isset($payload['LAST_ID']) ? ($this->pages[$payload['LAST_ID']] ?? []) : ($this->histories[$payload['SESSION_ID']] ?? [])),
            default => throw new RuntimeException('Current message discovery is read only.'),
        };
        if ($this->afterRead) {
            ($this->afterRead)($method, $payload);
        }

        return $result;
    }
}

function currentMessageFixture(): array
{
    $payload = ['id' => '700001', 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => '2026-11-12T12:00:00Z', 'messageContent' => ['type' => 'TEXT', 'text' => 'Consulta']];
    $event = (object) ['id' => 11, 'message_id' => '700001', 'subject_id' => '2423',
        'payload' => Crypt::encryptString(json_encode($payload))];
    $fake = new CurrentMessageReadFake;
    $code = 'whatsappbyedna|1|5493510000000@2423|901';
    $fake->records = ['LEAD' => [['ID' => '101', 'PHONE' => [['VALUE' => '+54 9 3510000000']]]],
        'CONTACT' => [['ID' => '301', 'PHONE' => [['VALUE' => '3510000000']]]]];
    $fake->chats = ['lead:101' => [['CHAT_ID' => '601', 'CONNECTOR_ID' => 'whatsappbyedna']],
        'contact:301' => [['CHAT_ID' => '601', 'CONNECTOR_ID' => 'whatsappbyedna']]];
    $fake->activities = ['501' => [['ID' => '801', 'OWNER_TYPE_ID' => '1', 'OWNER_ID' => '101',
        'PROVIDER_ID' => 'IMOPENLINES_SESSION', 'ASSOCIATED_ENTITY_ID' => '501', 'PROVIDER_PARAMS' => ['USER_CODE' => $code]]]];
    $fake->histories = ['501' => ['sessionId' => 501, 'chatId' => 601, 'hasNextPage' => false,
        'users' => ['901' => ['connector' => true]], 'message' => ['701' => [
            'id' => '701', 'chatid' => '601', 'senderid' => '901', 'date' => '2020-01-01T00:00:00Z',
            'params' => ['connectorMid' => ['700001']],
        ]]]];
    $fake->dialogs = ['601' => ['id' => 601, 'entity_type' => 'LINES', 'entity_id' => $code,
        'entity_data_1' => 'Y|LEAD|101|N|N|501|0|0|0|0', 'entity_data_2' => 'LEAD|101|CONTACT|0|DEAL|0']];

    return [$event, $payload, $fake];
}

function currentMessageSecondChat(CurrentMessageReadFake $fake): void
{
    $fake->chats['lead:101'][] = ['CHAT_ID' => '602', 'CONNECTOR_ID' => 'whatsappbyedna'];
    $fake->dialogs['602'] = array_replace($fake->dialogs['601'], ['id' => 602, 'entity_data_1' => 'Y|LEAD|101|N|N|502|0|0|0|0']);
    $fake->activities['502'] = [array_replace($fake->activities['501'][0], ['ID' => '802', 'ASSOCIATED_ENTITY_ID' => '502'])];
    $fake->histories['502'] = array_replace($fake->histories['501'], ['sessionId' => 502, 'chatId' => 602,
        'message' => ['702' => array_replace($fake->histories['501']['message']['701'], ['id' => '702', 'chatid' => '602'])]]);
}

function receiptCurrentMessageFixture(): array
{
    [$event, $payload, $fake] = currentMessageFixture();
    $fake->records['LEAD'][0]['CONTACT_ID'] = '301';
    $fake->deals = [['ID' => '401', 'LEAD_ID' => '101', 'CONTACT_ID' => '301', 'CATEGORY_ID' => '1']];
    $fake->chats = ['deal:401' => [['CHAT_ID' => '601', 'CONNECTOR_ID' => 'whatsappbyedna']]];
    $fake->activities['501'][0]['OWNER_TYPE_ID'] = '2';
    $fake->activities['501'][0]['OWNER_ID'] = '401';
    $fake->dialogs['601']['entity_data_1'] = 'Y|DEAL|401|N|N|501|0|0|0|0';
    $fake->dialogs['601']['entity_data_2'] = 'LEAD|0|CONTACT|301|DEAL|401';

    return [$event, $payload, $fake];
}

test('an exact server receipt lead discovers its converted deal chat without choosing among phone duplicates', function () {
    [$event, $payload, $fake] = receiptCurrentMessageFixture();
    $fake->ids = ['LEAD' => range(1, 101), 'CONTACT' => range(1, 101)];

    expect((new EdnaMessageBinding($fake))->resolveReceipt($event, $payload, 101))->toMatchArray([
        'chat_id' => '601', 'session_id' => '501', 'activity_id' => '801', 'native_lead_id' => null,
    ]);
    $methods = array_column($fake->calls, 0);
    expect($methods)->not->toContain('crm.duplicate.findbycomm')
        ->and($fake->calls[0][1]['filter'])->toBe(['@ID' => ['101']])
        ->and($fake->calls[1][1]['filter'])->toBe(['LEAD_ID' => 101, 'CATEGORY_ID' => 1])
        ->and(array_count_values($methods)['imopenlines.session.history.get'])->toBe(1);
});

test('a receipt hint cannot borrow a lead or deal whose exact identity relation changed', function (string $change) {
    [$event, $payload, $fake] = receiptCurrentMessageFixture();
    match ($change) {
        'lead' => $fake->records['LEAD'][0]['ID'] = '102',
        'phone' => $fake->records['LEAD'][0]['PHONE'] = [['VALUE' => '5493519999999']],
        'deal lead' => $fake->deals[0]['LEAD_ID'] = '102',
        'deal contact' => $fake->deals[0]['CONTACT_ID'] = '302',
        'deal category' => $fake->deals[0]['CATEGORY_ID'] = '5',
        'full page' => $fake->deals = array_fill(0, 50, $fake->deals[0]),
    };
    expect(fn () => (new EdnaMessageBinding($fake))->resolveReceipt($event, $payload, 101))->toThrow(RuntimeException::class)
        ->and(array_column($fake->calls, 0))->not->toContain('imopenlines.dialog.get', 'imopenlines.session.history.get');
})->with(['lead', 'phone', 'deal lead', 'deal contact', 'deal category', 'full page']);

test('receipt discovery still requires the exact connector message in the current native session', function () {
    [$event, $payload, $fake] = receiptCurrentMessageFixture();
    $fake->histories['501']['message']['701']['params']['connectorMid'] = ['unrelated'];
    $fake->histories['401'] = array_replace($fake->histories['501'], ['sessionId' => 401]);
    $fake->histories['401']['message']['701']['params']['connectorMid'] = [$event->message_id];

    expect((new EdnaMessageBinding($fake))->resolveReceipt($event, $payload, 101))->toBeNull();
    $history = array_values(array_filter($fake->calls, fn ($call) => $call[0] === 'imopenlines.session.history.get'));
    expect(array_column(array_column($history, 1), 'SESSION_ID'))->toBe([501]);
});

test('two current receipt chats proving the same connector message remain ambiguous', function () {
    [$event, $payload, $fake] = receiptCurrentMessageFixture();
    currentMessageSecondChat($fake);
    $fake->chats['deal:401'][] = ['CHAT_ID' => '602', 'CONNECTOR_ID' => 'whatsappbyedna'];
    expect((new EdnaMessageBinding($fake))->resolveReceipt($event, $payload, 101))->toBeNull();
});

test('a receipt discovery retry cannot revive the connector proof from an earlier session', function () {
    [$event, $payload, $fake] = receiptCurrentMessageFixture();
    $resolver = new EdnaMessageBinding($fake);
    expect($resolver->resolveReceipt($event, $payload, 101)['session_id'])->toBe('501');
    $fake->dialogs['601']['entity_data_1'] = 'Y|DEAL|401|N|N|502|0|0|0|0';
    $fake->activities['502'] = [array_replace($fake->activities['501'][0], ['ASSOCIATED_ENTITY_ID' => '502'])];
    $fake->histories['502'] = array_replace($fake->histories['501'], ['sessionId' => 502, 'message' => []]);
    expect($resolver->resolveReceipt($event, $payload, 101))->toBeNull();
});

test('current discovery proves the exact message without examining a truncated old session', function () {
    [$event, $payload, $fake] = currentMessageFixture();
    $fake->histories['401'] = ['sessionId' => 401, 'chatId' => 601, 'hasNextPage' => true, 'message' => []];

    $proof = (new EdnaMessageBinding($fake))->resolveCurrent($event, $payload);

    expect($proof)->toMatchArray(['verified' => true, 'chat_id' => '601', 'session_id' => '501', 'message_id' => '701', 'activity_id' => '801']);
    expect(array_column($fake->calls, 0))->toBe(['crm.duplicate.findbycomm', 'crm.duplicate.findbycomm', 'crm.lead.list',
        'imopenlines.crm.chat.get', 'imopenlines.dialog.get', 'crm.activity.list', 'imopenlines.session.history.get']);
    expect($fake->calls[3][1])->toBe(['CRM_ENTITY_TYPE' => 'lead', 'CRM_ENTITY' => 101, 'ACTIVE_ONLY' => 'N'])
        ->and($fake->calls[5][1]['filter'])->toBe(['ASSOCIATED_ENTITY_ID' => 501, 'PROVIDER_ID' => 'IMOPENLINES_SESSION']);
    expect(json_encode($proof))->not->toContain('5493510000000', 'Consulta');
});

test('a candidate chat whose current activity belongs to a deal is still proved by its exact message', function () {
    [$event, $payload, $fake] = currentMessageFixture();
    $fake->activities['501'][0]['OWNER_TYPE_ID'] = '2';
    $fake->activities['501'][0]['OWNER_ID'] = '401';
    $fake->dialogs['601']['entity_data_2'] = 'LEAD|0|CONTACT|301|DEAL|401';

    expect((new EdnaMessageBinding($fake))->resolveCurrent($event, $payload))
        ->toMatchArray(['chat_id' => '601', 'activity_id' => '801', 'native_lead_id' => null]);
});

test('all lead and contact candidates are revalidated and duplicate chat links are read once', function () {
    [$event, $payload, $fake] = currentMessageFixture();
    $fake->ids['CONTACT'] = ['301'];

    expect((new EdnaMessageBinding($fake))->resolveCurrent($event, $payload)['chat_id'])->toBe('601');
    $methods = array_column($fake->calls, 0);
    expect(array_slice($methods, 0, 4))->toBe(['crm.duplicate.findbycomm', 'crm.duplicate.findbycomm', 'crm.lead.list', 'crm.contact.list'])
        ->and(array_count_values($methods)['imopenlines.crm.chat.get'])->toBe(2)
        ->and(array_count_values($methods)['imopenlines.session.history.get'])->toBe(1);
});

test('two current chats proving the same external message remain ambiguous', function () {
    [$event, $payload, $fake] = currentMessageFixture();
    currentMessageSecondChat($fake);
    expect((new EdnaMessageBinding($fake))->resolveCurrent($event, $payload))->toBeNull()
        ->and(array_count_values(array_column($fake->calls, 0))['imopenlines.session.history.get'])->toBe(2);
});

test('two proofs in one chat cannot disappear behind a single proof in another chat', function () {
    [$event, $payload, $fake] = currentMessageFixture();
    currentMessageSecondChat($fake);
    $fake->histories['501']['message']['703'] = array_replace($fake->histories['501']['message']['701'], ['id' => '703']);

    expect((new EdnaMessageBinding($fake))->resolveCurrent($event, $payload))->toBeNull();
});

function currentMenuHistory(CurrentMessageReadFake $fake): array
{
    return $fake->histories['501'] + ['chat' => ['601' => ['id' => 601, 'entityType' => 'LINES',
        'entityId' => $fake->dialogs['601']['entity_id'], 'entityData1' => $fake->dialogs['601']['entity_data_1'],
        'entityData2' => $fake->dialogs['601']['entity_data_2']]]];
}

test('a verified chat hint confirms an exact native message on a long first page without CRM rediscovery', function () {
    [$event, $payload, $fake] = currentMessageFixture();
    $fake->chatHistories['601'] = array_replace(currentMenuHistory($fake), ['hasNextPage' => true]);
    expect((new EdnaMessageBinding($fake))->resolveMenuHint($event, $payload, 601))->toMatchArray([
        'chat_id' => '601', 'session_id' => '501', 'message_id' => '701', 'activity_id' => '801',
    ])->and(array_column($fake->calls, 0))->toBe(['imopenlines.session.history.get', 'crm.activity.list']);
});

test('a missing message on the hint first page returns to discovery without paging a stale chat', function () {
    [$event, $payload, $fake] = currentMessageFixture();
    $fake->chatHistories['601'] = array_replace(currentMenuHistory($fake), ['hasNextPage' => true, 'message' => []]);
    expect((new EdnaMessageBinding($fake))->resolveMenuHint($event, $payload, 601))->toBeNull()
        ->and(array_count_values(array_column($fake->calls, 0))['imopenlines.session.history.get'])->toBe(1);
});

test('a reopened session or a different channel cannot inherit a previous chat proof', function (string $change) {
    [$event, $payload, $fake] = currentMessageFixture();
    $h = currentMenuHistory($fake);
    if ($change === 'session') {
        $h['chat']['601']['entityData1'] = 'Y|LEAD|101|N|N|502|0|0|0|0';
    } else {
        $h['chat']['601']['entityId'] = 'whatsappbyedna|2|5493510000000@2423|901';
    }
    $fake->chatHistories['601'] = $h;
    expect((new EdnaMessageBinding($fake))->resolveMenuHint($event, $payload, 601))->toBeNull()
        ->and(array_column($fake->calls, 0))->toBe(['imopenlines.session.history.get']);
})->with(['session', 'channel']);

test('current session follows native cursors on a miss and rejects switched sessions or stalled cursors', function (string $variant) {
    [$event, $payload, $fake] = currentMessageFixture();
    $second = $fake->histories['501'];
    $first = array_replace($second, ['message' => [], 'hasNextPage' => true, 'nextId' => 800, 'nextDate' => 1700000000]);
    $fake->histories['501'] = $first;
    $fake->pages['800'] = match ($variant) {
        'found' => $second, 'switched' => array_replace($second, ['sessionId' => 502]), default => $first,
    };
    $resolve = fn () => (new EdnaMessageBinding($fake))->resolveCurrent($event, $payload, 601);
    if ($variant === 'found') {
        expect($resolve()['message_id'])->toBe('701');
    } else {
        expect($resolve)->toThrow(RuntimeException::class);
    }
    expect(end($fake->calls)[1])->toBe(['SESSION_ID' => 501, 'LAST_ID' => 800, 'LAST_DATE' => 1700000000]);
})->with(['found', 'switched', 'stalled']);

test('matching messages on visible pages of two current chats remain ambiguous', function () {
    [$event, $payload, $fake] = currentMessageFixture();
    currentMessageSecondChat($fake);
    $fake->histories['502']['hasNextPage'] = true;
    expect((new EdnaMessageBinding($fake))->resolveCurrent($event, $payload))->toBeNull();
});

test('full chat discovery pages fail before connector filtering or deduplication', function () {
    [$event, $payload, $fake] = currentMessageFixture();
    $fake->chats['lead:101'] = [$fake->chats['lead:101'][0], ...array_fill(0, 49, ['CHAT_ID' => '900', 'CONNECTOR_ID' => 'telegram'])];
    expect(fn () => (new EdnaMessageBinding($fake))->resolveCurrent($event, $payload))
        ->toThrow(RuntimeException::class, 'chat discovery is incomplete')
        ->and(array_column($fake->calls, 0))->not->toContain('imopenlines.dialog.get');
});

test('malformed or conflicting CRM chat discovery never becomes proof', function (string $change) {
    [$event, $payload, $fake] = currentMessageFixture();
    match ($change) {
        'not-list' => $fake->chats['lead:101'] = ['result' => $fake->chats['lead:101']],
        'missing-connector' => $fake->chats['lead:101'] = [['CHAT_ID' => '601']],
        'invalid-id' => $fake->chats['lead:101'][0]['CHAT_ID'] = '../601',
        'invalid-connector-type' => $fake->chats['lead:101'][0]['CONNECTOR_ID'] = ['whatsappbyedna'],
        'conflicting-connector' => $fake->chats['lead:101'][] = ['CHAT_ID' => '601', 'CONNECTOR_ID' => 'telegram'],
    };
    expect(fn () => (new EdnaMessageBinding($fake))->resolveCurrent($event, $payload))->toThrow(RuntimeException::class)
        ->and(array_column($fake->calls, 0))->not->toContain('imopenlines.dialog.get');
})->with(['not-list', 'missing-connector', 'invalid-id', 'invalid-connector-type', 'conflicting-connector']);

test('a later candidate with incomplete discovery cannot be hidden by an earlier candidate', function () {
    [$event, $payload, $fake] = currentMessageFixture();
    $fake->ids['CONTACT'] = ['301'];
    $fake->chats['contact:301'] = ['unexpected' => true];
    expect(fn () => (new EdnaMessageBinding($fake))->resolveCurrent($event, $payload))->toThrow(RuntimeException::class)
        ->and(array_column($fake->calls, 0))->not->toContain('imopenlines.session.history.get');
});

test('every candidate phone must match before the first chat relation is used', function (string $change) {
    [$event, $payload, $fake] = currentMessageFixture();
    $fake->ids['CONTACT'] = ['301'];
    match ($change) {
        'wrong-phone' => $fake->records['CONTACT'][0]['PHONE'] = [['VALUE' => '5493519999999']],
        'missing-record' => $fake->records['CONTACT'] = [],
        'extra-record' => $fake->records['CONTACT'][] = $fake->records['CONTACT'][0],
    };
    expect(fn () => (new EdnaMessageBinding($fake))->resolveCurrent($event, $payload))->toThrow(RuntimeException::class)
        ->and(array_column($fake->calls, 0))->not->toContain('imopenlines.crm.chat.get');
})->with(['wrong-phone', 'missing-record', 'extra-record']);

test('the global current chat limit is enforced before any session reads', function () {
    [$event, $payload, $fake] = currentMessageFixture();
    $fake->chats['lead:101'] = array_map(fn ($id) => ['CHAT_ID' => (string) $id, 'CONNECTOR_ID' => 'whatsappbyedna'], range(601, 626));
    expect(fn () => (new EdnaMessageBinding($fake))->resolveCurrent($event, $payload))
        ->toThrow(RuntimeException::class, 'chat window requires review')
        ->and(array_column($fake->calls, 0))->not->toContain('imopenlines.dialog.get');
});

test('an exhausted read budget after one exact match cannot authorize an unchecked second chat', function () {
    [$event, $payload, $fake] = currentMessageFixture();
    currentMessageSecondChat($fake);
    $resolver = new EdnaMessageBinding($fake);
    $fake->afterRead = function ($method) use ($resolver) {
        if ($method === 'imopenlines.session.history.get') {
            (new ReflectionProperty(EdnaMessageBinding::class, 'deadline'))->setValue($resolver, microtime(true) - 1);
        }
    };
    expect(fn () => $resolver->resolveCurrent($event, $payload))->toThrow(RuntimeException::class, 'read budget exhausted');
});

test('a known choice chat only accepts its current session and never falls back to old sessions', function () {
    [$event, $payload, $fake] = currentMessageFixture();
    $fake->dialogs['601']['entity_data_1'] = 'Y|LEAD|101|N|N|502|0|0|0|0';
    expect((new EdnaMessageBinding($fake))->resolveCurrent($event, $payload, 601))->toBeNull()
        ->and(array_column($fake->calls, 0))->toBe(['imopenlines.dialog.get', 'crm.activity.list']);
});

test('current activity membership and native source cannot be forged by discovery', function (string $change) {
    [$event, $payload, $fake] = currentMessageFixture();
    match ($change) {
        'other-session-activity' => $fake->activities['501'][0]['ASSOCIATED_ENTITY_ID'] = '999',
        'history-session' => $fake->histories['501']['sessionId'] = 999,
        'native-sender' => $fake->histories['501']['message']['701']['senderid'] = '999',
    };
    expect(fn () => (new EdnaMessageBinding($fake))->resolveCurrent($event, $payload))->toThrow(RuntimeException::class);
})->with(['other-session-activity', 'history-session', 'native-sender']);
