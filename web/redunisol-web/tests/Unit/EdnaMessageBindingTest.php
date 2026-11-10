<?php

use App\Services\EdnaBitrix;
use App\Services\EdnaMessageBinding;
use Illuminate\Support\Facades\Crypt;
use Tests\TestCase;

uses(TestCase::class);

beforeEach(function () {
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('b', 32)));
    config()->set('edna.subject_id', '2423');
});

class MessageBindingReadFake extends EdnaBitrix
{
    public array $calls = [];

    public array $ids = ['LEAD' => ['101'], 'CONTACT' => []];

    public array $records = [];

    public array $activities = [];

    public array $histories = [];

    public array $dialogs = [];

    public bool $fail = false;

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = [$method, $payload];
        if ($this->fail) {
            throw new RuntimeException('private webhook credential must not escape');
        }

        return match ($method) {
            'crm.duplicate.findbycomm' => [$payload['entity_type'] => $this->ids[$payload['entity_type']]],
            'crm.lead.list' => $this->records['LEAD'],
            'crm.contact.list' => $this->records['CONTACT'],
            'crm.activity.list' => isset($payload['filter']['ASSOCIATED_ENTITY_ID'])
                ? $this->activities['session:'.$payload['filter']['ASSOCIATED_ENTITY_ID']] ?? []
                : $this->activities[$payload['filter']['OWNER_TYPE_ID'].':'.$payload['filter']['OWNER_ID']] ?? [],
            'imopenlines.session.history.get' => $this->histories[(string) $payload['SESSION_ID']] ?? [],
            'imopenlines.dialog.get' => $this->dialogs[(string) $payload['CHAT_ID']] ?? [],
            default => throw new RuntimeException('A message resolver must never mutate CRM.'),
        };
    }
}

function messageBindingFixture(): array
{
    $payload = ['id' => '700001', 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => '2026-11-10T12:00:00Z', 'messageContent' => ['type' => 'TEXT', 'text' => 'Consulta']];
    $event = (object) ['id' => 11, 'message_id' => '700001', 'subject_id' => '2423',
        'payload' => Crypt::encryptString(json_encode($payload))];
    $fake = new MessageBindingReadFake;
    $code = 'whatsappbyedna|1|5493510000000@2423|901';
    $fake->records = ['LEAD' => [['ID' => '101', 'PHONE' => [['VALUE' => '+54 9 3510000000']]]], 'CONTACT' => []];
    $activity = ['ID' => '801', 'OWNER_ID' => '101', 'OWNER_TYPE_ID' => '1', 'PROVIDER_ID' => 'IMOPENLINES_SESSION',
        'ASSOCIATED_ENTITY_ID' => '501', 'PROVIDER_PARAMS' => ['USER_CODE' => $code]];
    $fake->activities = ['1:101' => [$activity], 'session:501' => [$activity]];
    $fake->histories = ['501' => [
        'sessionId' => 501, 'chatId' => 601, 'hasNextPage' => false,
        'users' => ['901' => ['id' => '901', 'connector' => true]],
        'message' => ['701' => ['id' => '701', 'chatid' => '601', 'senderid' => '901',
            // The identity is the connector ID, not the text or an approximate timestamp.
            'date' => '2020-01-01T00:00:00Z', 'text' => 'An entirely different display text',
            'params' => ['connectorMid' => ['700001']]]],
    ]];
    $fake->dialogs = ['601' => ['id' => 601, 'entity_type' => 'LINES', 'entity_id' => $code,
        'entity_data_1' => 'Y|LEAD|101|N|N|501|0|0|0|0',
        'entity_data_2' => 'LEAD|101|CONTACT|0|COMPANY|0|DEAL|0', 'text_field_enabled' => true]];

    return [$event, $payload, $fake];
}

test('an exact authenticated native message proves the chat independently of text and date', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $proof = (new EdnaMessageBinding($fake))->resolve($event, $payload);

    expect($proof)->toBe([
        'version' => 1, 'source' => 'bitrix_openline_session', 'verified' => true,
        'evidence' => 'external_message_id', 'entry_event_id' => 11, 'entry_message_id' => '700001',
        'chat_id' => '601', 'session_id' => '501', 'message_id' => '701', 'activity_id' => '801', 'native_lead_id' => '101',
    ])->and(json_encode($proof))->not->toContain('5493510000000', 'Consulta');
    expect(array_column($fake->calls, 0))->toBe([
        'crm.duplicate.findbycomm', 'crm.duplicate.findbycomm', 'crm.lead.list',
        'crm.activity.list', 'imopenlines.session.history.get', 'imopenlines.dialog.get',
    ]);
});

test('contact candidates can locate a chat currently associated with a deal', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->ids = ['LEAD' => [], 'CONTACT' => ['301']];
    $fake->records['CONTACT'] = [['ID' => '301', 'PHONE' => [['VALUE' => '3510000000']]]];
    $fake->activities['3:301'] = $fake->activities['1:101'];
    $fake->dialogs['601']['entity_data_2'] = 'LEAD|0|CONTACT|301|COMPANY|0|DEAL|401';

    $proof = (new EdnaMessageBinding($fake))->resolve($event, $payload);

    expect($proof['activity_id'])->toBe('801')->and($proof['native_lead_id'])->toBeNull();
    expect($fake->calls[3][1]['filter'])->toMatchArray(['OWNER_TYPE_ID' => 3, 'OWNER_ID' => '301']);
});

test('the same activity found through a lead and contact is one proof', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->ids['CONTACT'] = ['301'];
    $fake->records['CONTACT'] = [['ID' => '301', 'PHONE' => [['VALUE' => '5493510000000']]]];
    $fake->activities['3:301'] = $fake->activities['1:101'];

    expect((new EdnaMessageBinding($fake))->resolve($event, $payload)['activity_id'])->toBe('801');
    expect(array_count_values(array_column($fake->calls, 0))['imopenlines.session.history.get'])->toBe(1);
});

test('inbox subject message and sender mismatches fail before CRM lookup', function (string $field) {
    [$event, $payload, $fake] = messageBindingFixture();
    match ($field) {
        'subject' => $payload['subjectId'] = '9999',
        'message' => $payload['id'] = '700999',
        'phone' => $payload['subscriber']['identifier'] = '5493519999999',
        'event-subject' => $event->subject_id = '9999',
        'event-message' => $event->message_id = '700999',
        'encrypted-payload' => $event->payload = 'invalid encrypted inbox',
    };

    expect(fn () => (new EdnaMessageBinding($fake))->resolve($event, $payload))->toThrow(RuntimeException::class)
        ->and($fake->calls)->toBe([]);
})->with(['subject', 'message', 'phone', 'event-subject', 'event-message', 'encrypted-payload']);

test('a shared phone and matching display text do not prove the external message', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->histories['501']['message']['701']['text'] = $payload['messageContent']['text'];
    $fake->histories['501']['message']['701']['params']['connectorMid'] = ['700999'];

    expect((new EdnaMessageBinding($fake))->resolve($event, $payload))->toBeNull();
});

test('complete empty candidate discovery returns no proof', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->ids = ['LEAD' => [], 'CONTACT' => []];

    expect((new EdnaMessageBinding($fake))->resolve($event, $payload))->toBeNull()
        ->and(array_column($fake->calls, 0))->toBe(['crm.duplicate.findbycomm', 'crm.duplicate.findbycomm']);
});

test('other connector line subject and sender identities do not prove a Ventas chat', function (string $code) {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->activities['1:101'][0]['PROVIDER_PARAMS']['USER_CODE'] = $code;

    expect((new EdnaMessageBinding($fake))->resolve($event, $payload))->toBeNull()
        ->and(array_column($fake->calls, 0))->not->toContain('imopenlines.session.history.get');
})->with([
    'telegram|1|5493510000000@2423|901',
    'whatsappbyedna|2|5493510000000@2423|901',
    'whatsappbyedna|1|5493510000000@9999|901',
    'whatsappbyedna|1|5493519999999@2423|901',
]);

test('truncated histories never prove uniqueness', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->histories['501']['hasNextPage'] = true;

    expect(fn () => (new EdnaMessageBinding($fake))->resolve($event, $payload))->toThrow(RuntimeException::class);
});

test('an exact ID duplicated across native messages remains ambiguous', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->histories['501']['message']['702'] = array_replace($fake->histories['501']['message']['701'], ['id' => '702']);

    expect((new EdnaMessageBinding($fake))->resolve($event, $payload))->toBeNull();
});

test('distinct activities carrying the same proof remain ambiguous', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->activities['1:101'][] = array_replace($fake->activities['1:101'][0], ['ID' => '802']);

    expect((new EdnaMessageBinding($fake))->resolve($event, $payload))->toBeNull();
});

test('native evidence must belong to the external sender and exact chat', function (string $field) {
    [$event, $payload, $fake] = messageBindingFixture();
    match ($field) {
        'chat' => $fake->histories['501']['message']['701']['chatid'] = '999',
        'sender' => $fake->histories['501']['message']['701']['senderid'] = '999',
        'connector' => $fake->histories['501']['users']['901']['connector'] = false,
        'session' => $fake->histories['501']['sessionId'] = 999,
    };

    expect(fn () => (new EdnaMessageBinding($fake))->resolve($event, $payload))->toThrow(RuntimeException::class);
})->with(['chat', 'sender', 'connector', 'session']);

test('a known reopened chat uses its current session even after CRM association moves to a deal', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->dialogs['601']['entity_data_1'] = 'Y|DEAL|401|N|N|502|0|0|0|0';
    $fake->dialogs['601']['entity_data_2'] = 'LEAD|0|CONTACT|301|DEAL|401';
    $fake->histories['502'] = array_replace($fake->histories['501'], ['sessionId' => 502]);
    $fake->activities['session:502'] = [array_replace($fake->activities['1:101'][0], [
        'ID' => '802', 'OWNER_ID' => '401', 'OWNER_TYPE_ID' => '2', 'ASSOCIATED_ENTITY_ID' => '502',
    ])];

    $proof = (new EdnaMessageBinding($fake))->resolve($event, $payload, 601);

    expect($proof)->toMatchArray(['chat_id' => '601', 'session_id' => '502', 'activity_id' => '802', 'native_lead_id' => null]);
    expect(array_column($fake->calls, 0))->toBe(['imopenlines.dialog.get', 'crm.activity.list', 'imopenlines.session.history.get']);
    expect($fake->calls[1][1]['filter'])->toBe(['ASSOCIATED_ENTITY_ID' => 502, 'PROVIDER_ID' => 'IMOPENLINES_SESSION']);
});

test('an old message proof cannot authorize a newer message in a reopened chat', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->histories['501']['message']['701']['params']['connectorMid'] = ['old-message'];

    expect((new EdnaMessageBinding($fake))->resolve($event, $payload, 601))->toBeNull();
});

test('a known chat without a current session never creates one or falls back to another chat', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->dialogs['601']['entity_data_1'] = 'Y|DEAL|401|N|N|0|0|0|0|0';

    expect((new EdnaMessageBinding($fake))->resolve($event, $payload, 601))->toBeNull()
        ->and(array_column($fake->calls, 0))->toBe(['imopenlines.dialog.get']);
});

test('an ignored known-session activity filter cannot select another session', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->activities['session:501'][0]['ASSOCIATED_ENTITY_ID'] = '999';

    expect(fn () => (new EdnaMessageBinding($fake))->resolve($event, $payload, 601))->toThrow(RuntimeException::class)
        ->and(array_column($fake->calls, 0))->not->toContain('imopenlines.session.history.get');
});

test('full activity pages and missing candidate records fail closed', function (string $condition) {
    [$event, $payload, $fake] = messageBindingFixture();
    match ($condition) {
        'full-page' => $fake->activities['1:101'] = array_fill(0, 50, $fake->activities['1:101'][0]),
        'missing-candidate' => $fake->records['LEAD'] = [],
        'wrong-candidate-phone' => $fake->records['LEAD'][0]['PHONE'] = [['VALUE' => '5493519999999']],
    };

    expect(fn () => (new EdnaMessageBinding($fake))->resolve($event, $payload))->toThrow(RuntimeException::class)
        ->and(array_column($fake->calls, 0))->not->toContain('imopenlines.session.history.get');
})->with(['full-page', 'missing-candidate', 'wrong-candidate-phone']);

test('too many candidates stop before remote session reads', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->ids['LEAD'] = array_map('strval', range(1, 101));

    expect(fn () => (new EdnaMessageBinding($fake))->resolve($event, $payload))->toThrow(RuntimeException::class)
        ->and(array_column($fake->calls, 0))->toBe(['crm.duplicate.findbycomm']);
});

test('transport errors are sanitized without retaining the original exception', function () {
    [$event, $payload, $fake] = messageBindingFixture();
    $fake->fail = true;

    try {
        (new EdnaMessageBinding($fake))->resolve($event, $payload);
        test()->fail('The transport should have failed.');
    } catch (RuntimeException $error) {
        expect($error->getMessage())->toBe('Message binding read failed.')->and($error->getPrevious())->toBeNull();
    }
});
