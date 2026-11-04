<?php

use App\Services\EdnaBitrix;
use App\Services\EdnaIntakeBinding;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 4)->setTime(12, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('b', 32)));
    config()->set('edna.subject_id', '2423');
});

afterEach(function () {
    if (app()->bound(IntakeBindingReadFake::class)) {
        foreach (app(IntakeBindingReadFake::class)->calls as [$method]) {
            expect($method)->toBeIn(['crm.duplicate.findbycomm', 'crm.lead.list', 'crm.activity.list',
                'imopenlines.session.history.get', 'imopenlines.dialog.get']);
        }
    }
});

class IntakeBindingReadFake extends EdnaBitrix
{
    public array $calls = [];

    public array $leadIds = ['101'];

    public array $leads = [];

    public array $activities = [];

    public array $histories = [];

    public array $dialogs = [];

    public ?Closure $beforeCall = null;

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = [$method, $payload];
        if ($this->beforeCall) {
            ($this->beforeCall)($method, $payload);
        }

        return match ($method) {
            'crm.duplicate.findbycomm' => ['LEAD' => $this->leadIds],
            'crm.lead.list' => $this->leads,
            'crm.activity.list' => $this->activities[(string) $payload['filter']['OWNER_ID']] ?? [],
            'imopenlines.session.history.get' => $this->histories[(string) $payload['SESSION_ID']] ?? [],
            'imopenlines.dialog.get' => $this->dialogs[(string) $payload['CHAT_ID']] ?? [],
            default => throw new RuntimeException('Unexpected CRM operation in binding resolver.'),
        };
    }
}

function intakeBindingFixture(array $leadIds = ['101']): array
{
    $entryId = DB::table('edna_incoming_events')->insertGetId([
        'subject_id' => '2423', 'message_id' => '700001',
        'payload' => Crypt::encryptString(json_encode([
            'id' => '700001', 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
            'receivedAt' => now()->toIso8601String(), 'messageContent' => ['type' => 'TEXT', 'text' => 'Consulta'],
        ])),
        'status' => 'delivered', 'created_at' => now(), 'updated_at' => now(),
    ]);
    $sendId = DB::table('edna_flow_sends')->insertGetId([
        'request_id' => 'e51a09fd-3567-434b-b6c4-5da9d008472b', 'entry_event_id' => $entryId,
        'scope' => str_repeat('b', 64), 'subject_id' => '2423', 'cascade_id' => '2557',
        'flow_id' => '950118281197789', 'recipient' => Crypt::encryptString('5493510000000'),
        'state' => 'completed', 'entry_received_at' => now(), 'created_at' => now(), 'updated_at' => now(),
    ]);
    $fake = new IntakeBindingReadFake;
    app()->instance(IntakeBindingReadFake::class, $fake);
    $fake->leadIds = $leadIds;
    foreach ($leadIds as $index => $leadId) {
        $session = (string) (501 + $index);
        $chat = (string) (601 + $index);
        $message = (string) (701 + $index);
        $code = 'whatsappbyedna|1|external-chat-'.$index.'|external-user-'.$index;
        $fake->leads[] = ['ID' => $leadId, 'PHONE' => [['VALUE' => '5493510000000']]];
        $fake->activities[$leadId] = [[
            'ID' => 801 + $index, 'OWNER_ID' => $leadId, 'OWNER_TYPE_ID' => 1,
            'PROVIDER_ID' => 'IMOPENLINES_SESSION', 'ASSOCIATED_ENTITY_ID' => $session,
            'PROVIDER_PARAMS' => ['USER_CODE' => $code],
        ]];
        $fake->histories[$session] = [
            'sessionId' => (int) $session, 'chatId' => (int) $chat, 'hasNextPage' => false,
            'message' => [$message => ['id' => $message, 'chatid' => $chat,
                'date' => now()->toIso8601String(), 'params' => ['connectorMid' => ['700001']]]],
        ];
        $fake->dialogs[$chat] = [
            'id' => (int) $chat, 'entity_type' => 'LINES', 'entity_id' => $code,
            'entity_data_2' => 'LEAD|'.$leadId.'|CONTACT|0|COMPANY|0|DEAL|0',
            // An exact historic session remains valid after the current session closes.
            'entity_data_1' => 'Y|LEAD|'.$leadId.'|N|N|0|0|0|0|0', 'text_field_enabled' => false,
        ];
    }

    return [DB::table('edna_flow_sends')->find($sendId), $fake];
}

function intakeBindingRow(object $send): object
{
    return DB::table('edna_intake_bindings')->where('flow_send_id', $send->id)->first();
}

test('native connector message proves the original lead even with a closed current session', function () {
    [$send, $fake] = intakeBindingFixture();
    $proof = (new EdnaIntakeBinding($fake))->resolve($send);

    expect($proof)->toMatchArray([
        'version' => 1, 'source' => 'bitrix_openline_session', 'verified' => true,
        'lead_id' => '101', 'chat_id' => '601', 'session_id' => '501', 'message_id' => '701',
        'entry_event_id' => $send->entry_event_id, 'entry_message_id' => '700001', 'evidence' => 'external_message_id',
    ])->and(intakeBindingRow($send)->state)->toBe('verified');
    expect(array_column($fake->calls, 0))->toBe([
        'crm.duplicate.findbycomm', 'crm.lead.list', 'crm.activity.list',
        'imopenlines.session.history.get', 'imopenlines.dialog.get',
    ]);
    expect($fake->calls[3][1])->toBe(['SESSION_ID' => 501]);
    expect(intakeBindingRow($send)->proof)->not->toContain('5493510000000', 'Consulta');
});

test('a verified binding is reused without another CRM lookup', function () {
    [$send, $fake] = intakeBindingFixture();
    $resolver = new EdnaIntakeBinding($fake);
    $proof = $resolver->resolve($send);
    $fake->calls = [];

    expect($resolver->verified($send))->toBe($proof)
        ->and($resolver->resolve($send))->toBe($proof)->and($fake->calls)->toBe([]);
});

test('the processing lookup never discovers a missing binding remotely', function () {
    [$send, $fake] = intakeBindingFixture();

    expect((new EdnaIntakeBinding($fake))->verified($send))->toBeNull()
        ->and($fake->calls)->toBe([])
        ->and(DB::table('edna_intake_bindings')->count())->toBe(0);
});

test('another case cannot adopt a stored binding', function () {
    [$send, $fake] = intakeBindingFixture();
    DB::table('edna_intake_bindings')->insert([
        'flow_send_id' => $send->id, 'case_id' => '81b506e4-0811-4e3a-a1a6-39e375bff166',
        'entry_event_id' => $send->entry_event_id, 'state' => 'pending', 'created_at' => now(), 'updated_at' => now(),
    ]);

    expect(fn () => (new EdnaIntakeBinding($fake))->resolve($send))->toThrow(RuntimeException::class)
        ->and($fake->calls)->toBe([]);
});

test('authenticated entry mismatches cannot reach CRM discovery', function (string $mismatch) {
    [$send, $fake] = intakeBindingFixture();
    $payload = json_decode(Crypt::decryptString(DB::table('edna_incoming_events')->find($send->entry_event_id)->payload), true);
    match ($mismatch) {
        'phone' => $payload['subscriber']['identifier'] = '5493519999999',
        'message' => $payload['id'] = '700999',
        'subject' => $payload['subjectId'] = '9999',
    };
    DB::table('edna_incoming_events')->where('id', $send->entry_event_id)->update(['payload' => Crypt::encryptString(json_encode($payload))]);

    expect(fn () => (new EdnaIntakeBinding($fake))->resolve($send))->toThrow(RuntimeException::class)
        ->and($fake->calls)->toBe([]);
})->with(['phone', 'message', 'subject']);

test('same phone alone cannot prove an original lead', function () {
    [$send, $fake] = intakeBindingFixture();
    $fake->histories['501']['message']['701']['params']['connectorMid'] = ['700999'];

    expect((new EdnaIntakeBinding($fake))->resolve($send))->toBeNull()
        ->and(intakeBindingRow($send)->state)->toBe('pending');
});

test('another authenticated subject cannot resolve a Ventas binding', function () {
    [$send, $fake] = intakeBindingFixture();
    config()->set('edna.subject_id', '9999');

    expect(fn () => (new EdnaIntakeBinding($fake))->resolve($send))->toThrow(RuntimeException::class)
        ->and($fake->calls)->toBe([]);
});

test('a mismatched candidate phone fails before session discovery', function () {
    [$send, $fake] = intakeBindingFixture();
    $fake->leads[0]['PHONE'] = [['VALUE' => '5493519999999']];

    expect(fn () => (new EdnaIntakeBinding($fake))->resolve($send))->toThrow(RuntimeException::class)
        ->and(array_column($fake->calls, 0))->not->toContain('crm.activity.list');
});

test('other lines and connectors cannot prove the Ventas source', function (string $code) {
    [$send, $fake] = intakeBindingFixture();
    $fake->activities['101'][0]['PROVIDER_PARAMS']['USER_CODE'] = $code;

    expect((new EdnaIntakeBinding($fake))->resolve($send))->toBeNull()
        ->and(array_column($fake->calls, 0))->not->toContain('imopenlines.session.history.get');
})->with(['whatsappbyedna|2|external-chat|external-user', 'telegram|1|external-chat|external-user']);

test('a complete session with a different CRM binding is not the source', function () {
    [$send, $fake] = intakeBindingFixture();
    $fake->dialogs['601']['entity_data_2'] = 'LEAD|999|CONTACT|0';

    expect((new EdnaIntakeBinding($fake))->resolve($send))->toBeNull()
        ->and(intakeBindingRow($send)->state)->not->toBe('verified');
});

test('truncated histories cannot establish unique source evidence', function () {
    [$send, $fake] = intakeBindingFixture();
    $fake->histories['501']['hasNextPage'] = true;

    try {
        $proof = (new EdnaIntakeBinding($fake))->resolve($send);
    } catch (RuntimeException) {
        $proof = null;
    }

    expect($proof)->toBeNull()
        ->and(intakeBindingRow($send)->state)->not->toBe('verified');
});

test('one valid candidate cannot hide a truncated competing session', function () {
    [$send, $fake] = intakeBindingFixture(['101', '102']);
    $fake->histories['502']['hasNextPage'] = true;
    try {
        $proof = (new EdnaIntakeBinding($fake))->resolve($send);
    } catch (RuntimeException) {
        $proof = null;
    }

    expect($proof)->toBeNull()
        ->and(intakeBindingRow($send)->state)->not->toBe('verified');
});

test('native message evidence must match session chat and receive time', function (string $mismatch) {
    [$send, $fake] = intakeBindingFixture();
    match ($mismatch) {
        'session' => $fake->histories['501']['sessionId'] = 999,
        'chat' => $fake->histories['501']['message']['701']['chatid'] = '999',
        'time' => $fake->histories['501']['message']['701']['date'] = now()->subMinutes(6)->toIso8601String(),
    };

    expect(fn () => (new EdnaIntakeBinding($fake))->resolve($send))->toThrow(RuntimeException::class)
        ->and(intakeBindingRow($send)->state)->not->toBe('verified');
})->with(['session', 'chat', 'time']);

test('a native external ID appearing in two messages remains ambiguous', function () {
    [$send, $fake] = intakeBindingFixture();
    $fake->histories['501']['message']['702'] = array_replace($fake->histories['501']['message']['701'], ['id' => '702']);

    expect((new EdnaIntakeBinding($fake))->resolve($send))->toBeNull()
        ->and(intakeBindingRow($send)->reason)->toBe('crm_binding_ambiguous');
});

test('two proven leads sharing a phone remain ambiguous', function () {
    [$send, $fake] = intakeBindingFixture(['101', '102']);

    expect((new EdnaIntakeBinding($fake))->resolve($send))->toBeNull()
        ->and(intakeBindingRow($send)->reason)->toBe('crm_binding_ambiguous');
});

test('exact native evidence selects the source among multiple same phone candidates', function () {
    [$send, $fake] = intakeBindingFixture(['101', '102']);
    $fake->histories['502']['message']['702']['params']['connectorMid'] = ['700999'];

    expect((new EdnaIntakeBinding($fake))->resolve($send)['lead_id'])->toBe('101');
});

test('a lead already bound to another case requires review', function () {
    [$send, $fake] = intakeBindingFixture();
    DB::table('edna_intake_bindings')->insert([
        'flow_send_id' => 999, 'case_id' => '7af4c410-b23b-4516-b4d1-bb5a6b213eac', 'entry_event_id' => 999,
        'state' => 'verified', 'lead_id' => '101', 'proof' => '{}', 'created_at' => now(), 'updated_at' => now(),
    ]);

    expect((new EdnaIntakeBinding($fake))->resolve($send))->toBeNull()
        ->and(intakeBindingRow($send)->state)->toBe('review')
        ->and(intakeBindingRow($send)->reason)->toBe('crm_lead_already_bound');
});

test('candidate discovery is bounded before session scans', function () {
    [$send, $fake] = intakeBindingFixture();
    $fake->leadIds = array_map('strval', range(1, 101));

    expect((new EdnaIntakeBinding($fake))->resolve($send))->toBeNull()
        ->and(intakeBindingRow($send)->reason)->toBe('crm_binding_ambiguous')
        ->and(array_column($fake->calls, 0))->toBe(['crm.duplicate.findbycomm']);
});

test('missing or repeated candidate records cannot hide an ambiguous source', function (bool $duplicate) {
    [$send, $fake] = intakeBindingFixture(['101', '102']);
    $fake->leads = $duplicate ? [$fake->leads[0], $fake->leads[0]] : [$fake->leads[0]];

    expect(fn () => (new EdnaIntakeBinding($fake))->resolve($send))->toThrow(RuntimeException::class)
        ->and(intakeBindingRow($send)->state)->not->toBe('verified');
})->with([false, true]);

test('a full activity page requires review before session discovery', function () {
    [$send, $fake] = intakeBindingFixture();
    $fake->activities['101'] = array_fill(0, 50, $fake->activities['101'][0]);

    expect(fn () => (new EdnaIntakeBinding($fake))->resolve($send))->toThrow(RuntimeException::class)
        ->and(array_column($fake->calls, 0))->not->toContain('imopenlines.session.history.get');
});

test('concurrently verified disagreeing evidence is never overwritten', function () {
    [$send, $fake] = intakeBindingFixture();
    $fake->beforeCall = function ($method) use ($send) {
        if ($method === 'imopenlines.dialog.get') {
            DB::table('edna_intake_bindings')->where('flow_send_id', $send->id)->update([
                'state' => 'verified', 'lead_id' => '999', 'proof' => json_encode(['lead_id' => '999']),
            ]);
        }
    };

    expect(fn () => (new EdnaIntakeBinding($fake))->resolve($send))->toThrow(RuntimeException::class)
        ->and(intakeBindingRow($send)->lead_id)->toBe('999');
});
