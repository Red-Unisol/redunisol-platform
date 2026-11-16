<?php

use App\Services\EdnaBitrix;
use App\Services\EdnaOrganicAttention;
use App\Services\WebFormReceipt;
use Tests\TestCase;

uses(TestCase::class);

beforeEach(function () {
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('a', 32)));
    config()->set('edna.subject_id', '2423');
});

class OrganicAttentionReadFake extends EdnaBitrix
{
    public array $calls = [];

    public array $dialog = ['id' => 601, 'entity_type' => 'LINES', 'entity_id' => 'whatsappbyedna|1|5493510000000@2423|999',
        'entity_data_1' => 'Y|LEAD|700|N|N|501|1794333600|0|0|0', 'entity_data_2' => 'LEAD|700|COMPANY|0|CONTACT|0|DEAL|0',
        'owner' => 74827, 'text_field_enabled' => true];

    public array $records = ['lead:700' => ['ID' => '700', 'ASSIGNED_BY_ID' => '74827', 'CREATED_BY_ID' => '74827',
        'CONTACT_ID' => '0', 'COMPANY_ID' => '0', 'STATUS_ID' => 'NEW', 'STATUS_SEMANTIC_ID' => 'P', 'UF_CRM_1693840106704' => '20123456789']];

    public array $users = [['ID' => '5737', 'ACTIVE' => true, 'USER_TYPE' => 'employee', 'UF_DEPARTMENT' => [12], 'EXTERNAL_AUTH_ID' => '']];

    public array $session = ['id' => 501, 'chatId' => 601, 'configId' => 1, 'operatorId' => null,
        'status' => 'new', 'dateOperatorAnswer' => null, 'dateFirstAnswer' => null, 'dateClose' => null];

    public int $operatorMessages = 0;

    public ?Closure $beforeCall = null;

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = [$method, $payload];
        if ($this->beforeCall) {
            ($this->beforeCall)($method, $payload, $this);
        }
        if (preg_match('/^crm\.(lead|contact|deal|company)\.get$/D', $method, $m)) {
            return $this->records[$m[1].':'.$payload['id']] ?? null;
        }

        return match ($method) {
            'imopenlines.dialog.get' => $this->dialog,
            'imopenlines.config.get' => ['ID' => '1', 'QUEUE' => ['74827']],
            'imopenlines.v2.Session.list' => ['sessions' => [$this->session], 'hasNextPage' => false],
            'imopenlines.v2.Session.Stat.get' => ['sessions' => [['sessionId' => 501, 'messagesOperatorCount' => $this->operatorMessages, 'transfersCount' => 0]]],
            'imopenlines.v2.Session.Transfer.list' => ['transfers' => []],
            'user.get' => $this->users,
            default => throw new RuntimeException('Unexpected mutation.'),
        };
    }
}

function organicAttentionProof(): array
{
    return ['verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'chat_id' => '601', 'session_id' => '501', 'native_lead_id' => '700'];
}

function organicAttentionSnapshot(OrganicAttentionReadFake $fake): array
{
    return (new EdnaOrganicAttention($fake))->snapshot(organicAttentionProof());
}

test('organic attention delegates the unchanged live human guard and appends a sanitized native snapshot', function () {
    $fake = new OrganicAttentionReadFake;
    $attention = new EdnaOrganicAttention($fake);
    $result = $attention->inspect(organicAttentionProof(), 5737);
    expect($result)->toMatchArray(['status' => 'ready', 'owner_id' => 74827, 'session_id' => 501])
        ->and($attention->canTransfer($result['native_snapshot'], 5737))->toBeTrue()
        ->and($result['native_snapshot']['records'][0])->toMatchArray(['entity' => 'lead', 'id' => '700', 'owner' => '74827', 'native' => true]);
    foreach ($fake->calls as [$method]) {
        expect($method)->toBeIn(['imopenlines.dialog.get', 'imopenlines.config.get', 'imopenlines.v2.Session.list',
            'imopenlines.v2.Session.Stat.get', 'imopenlines.v2.Session.Transfer.list', 'crm.lead.get']);
    }
});

test('organic attention never makes an exception for operator replies or acceptance', function (string $kind) {
    $fake = new OrganicAttentionReadFake;
    if ($kind === 'message') {
        $fake->operatorMessages = 1;
    } else {
        $fake->session['dateOperatorAnswer'] = '2026-11-11T12:00:00Z';
    }
    $result = (new EdnaOrganicAttention($fake))->inspect(organicAttentionProof(), 5737);
    expect($result['status'])->toBe('preserved')->and($result['native_snapshot'])->toBeNull();
    expect(array_filter($fake->calls, fn ($call) => str_starts_with($call[0], 'crm.')))->toBeEmpty();
})->with(['message', 'acceptance']);

test('welcome eligibility preserves a chat already owned by Tincho and does not read CRM', function () {
    $fake = new OrganicAttentionReadFake;
    $fake->dialog['owner'] = 5737;
    $fake->session['dateOperatorAnswer'] = '2026-11-11T12:00:00Z';
    expect((new EdnaOrganicAttention($fake))->inspectWelcome(organicAttentionProof()))
        ->toMatchArray(['status' => 'preserved', 'reason' => 'chat_owner_preserved']);
    expect($fake->calls)->toHaveCount(1);
});

test('welcome eligibility keeps checking human attention without suppressing a menu for a CRM owner alone', function () {
    $fake = new OrganicAttentionReadFake;
    $fake->records['lead:700']['ASSIGNED_BY_ID'] = '71283';
    $service = new EdnaOrganicAttention($fake);
    expect($service->inspectWelcome(organicAttentionProof())['status'])->toBe('ready');
    $fake->operatorMessages = 1;
    expect($service->inspectWelcome(organicAttentionProof())['status'])->toBe('preserved');
});

test('already assigned transfer inspections still capture native CRM without making a transfer', function () {
    $fake = new OrganicAttentionReadFake;
    $fake->dialog['owner'] = 5737;
    $fake->records['lead:700']['ASSIGNED_BY_ID'] = '5737';
    $result = (new EdnaOrganicAttention($fake))->inspect(organicAttentionProof(), 5737);
    expect($result['status'])->toBe('already_assigned')->and($result['native_snapshot']['records'])->toHaveCount(1);
});

test('only a native lead with a matching receiver creator pair gets the provisional owner exception', function (string $owner, string $creator, bool $allowed) {
    $fake = new OrganicAttentionReadFake;
    $fake->records['lead:700']['ASSIGNED_BY_ID'] = $owner;
    $fake->records['lead:700']['CREATED_BY_ID'] = $creator;
    $fake->records['lead:700']['MODIFY_BY_ID'] = '71283';
    $attention = new EdnaOrganicAttention($fake);
    expect($attention->canTransfer($attention->snapshot(organicAttentionProof()), 5737))->toBe($allowed);
})->with([
    ['57', '57', true], ['74827', '74827', true], ['0', '', true], ['', '', true], ['5737', '29', true],
    ['57', '71283', false], ['74827', '', false], ['71283', '71283', false], ['29', '57', false],
]);

test('missing creator does not fall back to the modifier or the apparent provisional receiver', function () {
    $fake = new OrganicAttentionReadFake;
    unset($fake->records['lead:700']['CREATED_BY_ID']);
    $fake->records['lead:700']['MODIFY_BY_ID'] = '74827';
    $service = new EdnaOrganicAttention($fake);
    expect($service->canTransfer($service->snapshot(organicAttentionProof()), 5737))->toBeFalse();
});

test('a related contact manual owner is preserved even when entity data only lists a native lead', function () {
    $fake = new OrganicAttentionReadFake;
    $fake->records['lead:700']['CONTACT_ID'] = '800';
    $fake->records['contact:800'] = ['ID' => '800', 'ASSIGNED_BY_ID' => '57', 'CREATED_BY_ID' => '57'];
    $service = new EdnaOrganicAttention($fake);
    $snapshot = $service->snapshot(organicAttentionProof());
    expect($snapshot['records'])->toHaveCount(2)->and($service->canTransfer($snapshot, 5737))->toBeFalse();
});

test('all contacts and companies in plural relationships are read without an arbitrary winner', function () {
    $fake = new OrganicAttentionReadFake;
    $fake->records['lead:700']['CONTACT_IDS'] = ['800', '801'];
    $fake->records['contact:800'] = ['ID' => '800', 'ASSIGNED_BY_ID' => '5737', 'COMPANY_IDS' => ['900']];
    $fake->records['contact:801'] = ['ID' => '801', 'ASSIGNED_BY_ID' => '5737'];
    $fake->records['company:900'] = ['ID' => '900', 'ASSIGNED_BY_ID' => '29'];
    $service = new EdnaOrganicAttention($fake);
    $snapshot = $service->snapshot(organicAttentionProof());
    expect($snapshot['records'])->toHaveCount(4)->and($service->canTransfer($snapshot, 5737))->toBeFalse();
});

test('the current commercial seller can be reused when every attached CRM owner agrees', function () {
    $fake = new OrganicAttentionReadFake;
    $fake->dialog['entity_data_2'] = 'LEAD|700|COMPANY|0|CONTACT|800|DEAL|900';
    $fake->records['lead:700']['CONTACT_ID'] = '800';
    $fake->records['contact:800'] = ['ID' => '800', 'ASSIGNED_BY_ID' => '71159'];
    $fake->records['deal:900'] = ['ID' => '900', 'ASSIGNED_BY_ID' => '71159', 'CONTACT_ID' => '800', 'LEAD_ID' => '700', 'STAGE_ID' => 'C1:NEW', 'CATEGORY_ID' => '1'];
    $service = new EdnaOrganicAttention($fake);
    $snapshot = $service->snapshot(organicAttentionProof());
    expect($service->canTransfer($snapshot, 71159))->toBeTrue()->and($service->canTransfer($snapshot, 5737))->toBeFalse();
});

test('native snapshot rejects replaced sessions mismatched records and ambiguous bindings', function (string $change) {
    $fake = new OrganicAttentionReadFake;
    match ($change) {
        'session' => $fake->dialog['entity_data_1'] = 'Y|LEAD|700|N|N|502|1794333600',
        'chat' => $fake->dialog['id'] = 602,
        'source' => $fake->dialog['entity_id'] = 'whatsappbyedna|2|5493510000000@2423|999',
        'subject' => $fake->dialog['entity_id'] = 'whatsappbyedna|1|5493510000000@2424|999',
        'id' => $fake->records['lead:700']['ID'] = '701',
        'binding' => $fake->dialog['entity_data_2'] = 'LEAD|700|LEAD|701',
        'negative' => $fake->records['lead:700']['CONTACT_ID'] = '-1',
        'missing_owner' => $fake->records['lead:700'] = ['ID' => '700'],
        'null_owner' => $fake->records['lead:700']['ASSIGNED_BY_ID'] = null,
        'tuple_conflict' => $fake->dialog['entity_data_2'] = 'LEAD|701',
        'partial' => $fake->dialog['entity_data_2'] = 'LEAD|700|CONTACT',
    };
    expect(fn () => organicAttentionSnapshot($fake))->toThrow(RuntimeException::class, 'Organic CRM snapshot unavailable.');
})->with(['session', 'chat', 'source', 'subject', 'id', 'binding', 'negative', 'missing_owner', 'null_owner', 'tuple_conflict', 'partial']);

test('dialog changes during CRM reads are not returned as a usable snapshot', function () {
    $fake = new OrganicAttentionReadFake;
    $fake->beforeCall = function ($method, $payload, $crm) {
        if ($method === 'crm.lead.get') {
            $crm->dialog['owner'] = 29;
        }
    };
    expect((new EdnaOrganicAttention($fake))->inspect(organicAttentionProof(), 5737))
        ->toMatchArray(['status' => 'waiting', 'reason' => 'native_crm_snapshot_unavailable', 'native_snapshot' => null]);
});

test('a dialog changing between the human guard and snapshot preserves the assignment', function () {
    $fake = new OrganicAttentionReadFake;
    $dialogReads = 0;
    $fake->beforeCall = function ($method, $payload, $crm) use (&$dialogReads) {
        if ($method === 'imopenlines.dialog.get' && ++$dialogReads === 3) {
            $crm->dialog['owner'] = 57;
        }
    };
    expect((new EdnaOrganicAttention($fake))->inspect(organicAttentionProof(), 5737))
        ->toMatchArray(['status' => 'preserved', 'reason' => 'native_dialog_changed', 'native_snapshot' => null]);
});

test('a relationship graph exceeding the read budget cannot choose a partial set of owners', function () {
    $fake = new OrganicAttentionReadFake;
    for ($id = 700; $id <= 713; $id++) {
        $fake->records['lead:'.$id] = ['ID' => (string) $id, 'ASSIGNED_BY_ID' => '0', 'LEAD_ID' => (string) ($id + 1)];
    }
    expect(fn () => organicAttentionSnapshot($fake))->toThrow(RuntimeException::class, 'Organic CRM snapshot unavailable.');
    expect(count($fake->calls))->toBeLessThanOrEqual(16);
});

test('snapshot failures never expose the provider exception body or credential', function () {
    $fake = new OrganicAttentionReadFake;
    $fake->beforeCall = fn () => throw new RuntimeException('https://private.test/rest/secret customer 20123456789');
    try {
        organicAttentionSnapshot($fake);
        $this->fail('Expected a sanitized exception.');
    } catch (RuntimeException $error) {
        expect($error->getMessage())->toBe('Organic CRM snapshot unavailable.')->and($error->getPrevious())->toBeNull();
    }
});

test('snapshot bodies contain only technical fields and keyed CUIL hashes', function () {
    $fake = new OrganicAttentionReadFake;
    $fake->records['lead:700'] += ['PHONE' => [['VALUE' => '5493510000000']], 'NAME' => 'Private Customer', 'COMMENTS' => 'Private text'];
    $snapshot = organicAttentionSnapshot($fake);
    $json = json_encode($snapshot);
    expect($snapshot['records'][0]['identity_hash'])->toHaveLength(64)
        ->and($snapshot['records'][0]['identity_hash'])->toBe((new WebFormReceipt)->identityHash('20123456789'))
        ->and($json)->not->toContain('20123456789', '5493510000000', 'Private Customer', 'Private text', 'PHONE', 'COMMENTS');
});

test('pretransfer compatibility requires the exact snapshot including stages identity and tuple', function (string $change) {
    $fake = new OrganicAttentionReadFake;
    $service = new EdnaOrganicAttention($fake);
    $before = $service->snapshot(organicAttentionProof());
    match ($change) {
        'owner' => $fake->records['lead:700']['ASSIGNED_BY_ID'] = '5737',
        'stage' => $fake->records['lead:700']['STATUS_ID'] = 'IN_PROCESS',
        'identity' => $fake->records['lead:700']['UF_CRM_1693840106704'] = '20987654321',
        'tuple' => $fake->dialog['owner'] = 57,
        'same' => null,
    };
    expect($service->compatible($before, $service->snapshot(organicAttentionProof()), 5737))->toBe($change === 'same');
})->with(['owner', 'stage', 'identity', 'tuple', 'same']);

test('posttransfer compatibility admits only the expected chat and provisional native lead owner changes', function (string $change, bool $allowed) {
    $fake = new OrganicAttentionReadFake;
    $fake->dialog['entity_data_2'] = 'LEAD|700|CONTACT|800';
    $fake->records['contact:800'] = ['ID' => '800', 'ASSIGNED_BY_ID' => '0'];
    $service = new EdnaOrganicAttention($fake);
    $before = $service->snapshot(organicAttentionProof());
    $fake->dialog['owner'] = 5737;
    $fake->records['lead:700']['ASSIGNED_BY_ID'] = '5737';
    match ($change) {
        'contact' => $fake->records['contact:800']['ASSIGNED_BY_ID'] = '5737',
        'creator' => $fake->records['lead:700']['CREATED_BY_ID'] = '5737',
        'stage' => $fake->records['lead:700']['STATUS_ID'] = 'IN_PROCESS',
        'owner_elsewhere' => $fake->dialog['owner'] = 29,
        'same' => null,
    };
    expect($service->compatible($before, $service->snapshot(organicAttentionProof()), 5737, true))->toBe($allowed);
})->with([['same', true], ['contact', false], ['creator', false], ['stage', false], ['owner_elsewhere', false]]);

test('target lookup resolves only the exact active internal employee with a department', function (string $change, bool $allowed) {
    $fake = new OrganicAttentionReadFake;
    match ($change) {
        'id' => $fake->users[0]['ID'] = '5738',
        'inactive' => $fake->users[0]['ACTIVE'] = false,
        'external' => $fake->users[0]['USER_TYPE'] = 'extranet',
        'bot' => $fake->users[0]['EXTERNAL_AUTH_ID'] = 'bot',
        'department' => $fake->users[0]['UF_DEPARTMENT'] = [],
        'duplicate' => $fake->users[] = $fake->users[0],
        'legacy' => $fake->users[0] = ['ID' => '5737', 'ACTIVE' => 'Y', 'UF_DEPARTMENT' => ['12']],
        'same' => null,
    };
    expect((new EdnaOrganicAttention($fake))->targetActive(5737))->toBe($allowed);
    expect($fake->calls)->toBe([['user.get', ['FILTER' => ['ID' => '5737']]]]);
})->with([['same', true], ['legacy', true], ['id', false], ['inactive', false], ['external', false], ['bot', false], ['department', false], ['duplicate', false]]);

test('tampered or incomplete stored snapshots are rejected without reads', function () {
    $fake = new OrganicAttentionReadFake;
    $service = new EdnaOrganicAttention($fake);
    $snapshot = $service->snapshot(organicAttentionProof());
    $fake->calls = [];
    $snapshot['records'][0]['owner'] = '5737';
    expect($service->canTransfer($snapshot, 5737))->toBeFalse()->and($service->compatible($snapshot, $snapshot, 5737))->toBeFalse()
        ->and($service->canTransfer([], 5737))->toBeFalse()->and($fake->calls)->toBeEmpty();
});
