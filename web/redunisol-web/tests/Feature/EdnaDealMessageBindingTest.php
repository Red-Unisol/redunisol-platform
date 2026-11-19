<?php

use App\Services\EdnaBitrix;
use App\Services\EdnaDealMessageCutover;
use App\Services\EdnaMessageBinding;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 17)->setTime(12, 1));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('d', 32)));
    config()->set('edna.subject_id', '2423');
    DB::table('edna_intake_cutovers')->insert([
        'name' => EdnaDealMessageCutover::NAME, 'entry_id_after' => 10, 'starts_at' => '2026-11-17 12:00:00',
    ]);
    Queue::fake();
});

class DealMessageReadFake extends EdnaBitrix
{
    public array $calls = [];

    public array $ids = ['LEAD' => ['101'], 'CONTACT' => ['301']];

    public array $deals = [['ID' => '401', 'LEAD_ID' => '101', 'CONTACT_ID' => '301']];

    public array $activities = [];

    public array $legacyActivities = [];

    public array $history;

    public array $dialog;

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = [$method, $payload];

        return match ($method) {
            'crm.duplicate.findbycomm' => [$payload['entity_type'] => $this->ids[$payload['entity_type']]],
            'crm.lead.list', 'crm.contact.list' => array_map(fn ($id) => ['ID' => $id,
                'PHONE' => [['VALUE' => '5493510000000']]], $payload['filter']['@ID']),
            'crm.deal.list' => $this->deals,
            'crm.activity.list' => isset($payload['filter']['@OWNER_ID']) ? $this->activities : $this->legacyActivities,
            'imopenlines.session.history.get' => $this->history,
            'imopenlines.dialog.get' => $this->dialog,
            default => throw new RuntimeException('A discovery resolver may only read CRM.'),
        };
    }
}

function dealMessageFixture(): array
{
    $payload = ['id' => '700001', 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => now()->toIso8601String(), 'messageContent' => ['type' => 'TEXT', 'text' => 'Consulta web']];
    $event = (object) ['id' => 11, 'message_id' => '700001', 'subject_id' => '2423',
        'payload' => Crypt::encryptString(json_encode($payload))];
    $fake = new DealMessageReadFake;
    $code = 'whatsappbyedna|1|5493510000000@2423|901';
    $fake->activities = [['ID' => '801', 'OWNER_TYPE_ID' => '2', 'OWNER_ID' => '401',
        'PROVIDER_ID' => 'IMOPENLINES_SESSION', 'ASSOCIATED_ENTITY_ID' => '501', 'PROVIDER_PARAMS' => ['USER_CODE' => $code]]];
    $fake->history = ['sessionId' => 501, 'chatId' => 601, 'hasNextPage' => false,
        'users' => ['901' => ['connector' => true]], 'message' => [
            '701' => ['id' => '701', 'chatid' => '601', 'senderid' => '901', 'params' => ['connectorMid' => ['700001']]],
        ]];
    $fake->dialog = ['id' => 601, 'entity_type' => 'LINES', 'entity_id' => $code,
        'entity_data_1' => 'Y|DEAL|401|N|N|501|0|0|0|0', 'entity_data_2' => 'LEAD|0|CONTACT|301|DEAL|401',
        'owner' => 74827, 'text_field_enabled' => true];

    return [$event, $payload, $fake];
}

test('a new exact message finds an activity owned only by the related deal', function (string $source) {
    [$event, $payload, $fake] = dealMessageFixture();
    if ($source === 'lead') {
        $fake->ids['CONTACT'] = [];
    } elseif ($source === 'contact') {
        $fake->ids['LEAD'] = [];
    }
    $proof = (new EdnaMessageBinding($fake))->resolve($event, $payload);

    expect($proof)->toMatchArray(['chat_id' => '601', 'session_id' => '501', 'activity_id' => '801',
        'message_id' => '701', 'entry_message_id' => '700001', 'verified' => true]);
    expect(array_count_values(array_column($fake->calls, 0))['imopenlines.session.history.get'])->toBe(1);
    expect(array_column($fake->calls, 0))->not->toContain('imopenlines.operator.transfer', 'crm.activity.binding.add');
    Queue::assertNothingPushed();
})->with(['lead', 'contact', 'both']);

test('an already proven chat keeps its path even with a large related deal history', function () {
    [$event, $payload, $fake] = dealMessageFixture();
    $fake->ids['CONTACT'] = [];
    $fake->legacyActivities = $fake->activities;
    $fake->deals = array_fill(0, 50, $fake->deals[0]);

    expect((new EdnaMessageBinding($fake))->resolve($event, $payload)['activity_id'])->toBe('801')
        ->and(array_column($fake->calls, 0))->not->toContain('crm.deal.list');
});

test('old inbox entries and late old callbacks never gain deal discovery', function (string $condition) {
    [$event, $payload, $fake] = dealMessageFixture();
    if ($condition === 'old-id') {
        $event->id = 10;
    } elseif ($condition === 'old-date') {
        $payload['receivedAt'] = '2026-11-17T11:59:59Z';
        $event->payload = Crypt::encryptString(json_encode($payload));
    } else {
        DB::table('edna_intake_cutovers')->where('name', EdnaDealMessageCutover::NAME)->delete();
    }

    expect((new EdnaMessageBinding($fake))->resolve($event, $payload))->toBeNull()
        ->and(array_column($fake->calls, 0))->not->toContain('crm.deal.list');
    Queue::assertNothingPushed();
})->with(['old-id', 'old-date', 'not-activated']);

test('a changed caller timestamp cannot promote a stored old callback across the cut', function () {
    [$event, $payload, $fake] = dealMessageFixture();
    $stored = array_replace($payload, ['receivedAt' => '2026-11-17T11:59:59Z']);
    $event->payload = Crypt::encryptString(json_encode($stored));

    expect((new EdnaMessageBinding($fake))->resolve($event, $payload))->toBeNull()
        ->and(array_column($fake->calls, 0))->not->toContain('crm.deal.list');
});

test('related deals without the exact external message do not prove a chat', function () {
    [$event, $payload, $fake] = dealMessageFixture();
    $fake->history['message']['701']['params']['connectorMid'] = ['700999'];

    expect((new EdnaMessageBinding($fake))->resolve($event, $payload))->toBeNull();
});

test('the original sender and channel checks still apply to deal activities', function (string $field) {
    [$event, $payload, $fake] = dealMessageFixture();
    if ($field === 'phone') {
        $fake->activities[0]['PROVIDER_PARAMS']['USER_CODE'] = 'whatsappbyedna|1|5493519999999@2423|901';
    } elseif ($field === 'channel') {
        $fake->activities[0]['PROVIDER_PARAMS']['USER_CODE'] = 'whatsappbyedna|3|5493510000000@2423|901';
    } else {
        $fake->history['message']['701']['senderid'] = '999';
    }
    if ($field === 'sender') {
        expect(fn () => (new EdnaMessageBinding($fake))->resolve($event, $payload))->toThrow(RuntimeException::class);
    } else {
        expect((new EdnaMessageBinding($fake))->resolve($event, $payload))->toBeNull();
    }
})->with(['phone', 'channel', 'sender']);

test('ignored deal and activity filters fail closed before accepting an unrelated record', function (string $field) {
    [$event, $payload, $fake] = dealMessageFixture();
    if ($field === 'relation') {
        $fake->deals[0]['LEAD_ID'] = '999';
    } elseif ($field === 'activity-owner') {
        $fake->activities[0]['OWNER_ID'] = '999';
    } else {
        $fake->activities[0]['OWNER_TYPE_ID'] = '3';
    }

    expect(fn () => (new EdnaMessageBinding($fake))->resolve($event, $payload))->toThrow(RuntimeException::class)
        ->and(array_column($fake->calls, 0))->not->toContain('imopenlines.session.history.get');
})->with(['relation', 'activity-owner', 'activity-type']);

test('truncated related deal discovery cannot hide a second matching activity', function () {
    [$event, $payload, $fake] = dealMessageFixture();
    $fake->deals = array_fill(0, 50, $fake->deals[0]);

    expect(fn () => (new EdnaMessageBinding($fake))->resolve($event, $payload))->toThrow(RuntimeException::class)
        ->and(array_column($fake->calls, 0))->not->toContain('imopenlines.session.history.get');
});

test('multiple exact deal activity proofs remain ambiguous rather than choosing the first', function () {
    [$event, $payload, $fake] = dealMessageFixture();
    $fake->deals[] = array_replace($fake->deals[0], ['ID' => '402']);
    $fake->activities[] = array_replace($fake->activities[0], ['ID' => '802', 'OWNER_ID' => '402']);

    expect((new EdnaMessageBinding($fake))->resolve($event, $payload))->toBeNull();
});

test('deal activation is immutable and does not alter prior cuts or enqueue waiting work', function () {
    DB::table('edna_intake_cutovers')->where('name', EdnaDealMessageCutover::NAME)->delete();
    DB::table('edna_intake_cutovers')->insert(['name' => 'native-v3-v1', 'entry_id_after' => 0, 'starts_at' => now()->subDay()]);
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423', 'message_id' => '800001',
        'payload' => 'not processed by activation', 'status' => 'delivered', 'created_at' => now(), 'updated_at' => now()]);
    DB::table('web_form_chat_routes')->insert(['entry_event_id' => $id, 'state' => 'waiting',
        'reason' => 'native_message_pending', 'created_at' => now(), 'updated_at' => now()]);
    $before = DB::table('web_form_chat_routes')->first();
    $oldCut = DB::table('edna_intake_cutovers')->where('name', 'native-v3-v1')->first();
    $this->artisan('edna:deal-message-binding activate')->assertSuccessful();
    $cut = DB::table('edna_intake_cutovers')->where('name', EdnaDealMessageCutover::NAME)->first();
    expect((int) $cut->entry_id_after)->toBe($id)->and($cut->starts_at)->toBe(now()->addSecond()->format('Y-m-d H:i:s'));
    $this->travel(2)->minutes();
    $this->artisan('edna:deal-message-binding activate')->assertSuccessful();
    expect(DB::table('edna_intake_cutovers')->where('name', EdnaDealMessageCutover::NAME)->first())->toEqual($cut)
        ->and(DB::table('edna_intake_cutovers')->where('name', 'native-v3-v1')->first())->toEqual($oldCut)
        ->and(DB::table('web_form_chat_routes')->first())->toEqual($before);
    Queue::assertNothingPushed();
});
