<?php

use App\Services\EdnaBenefitsCase;
use App\Services\EdnaBitrix;
use App\Services\EdnaOrganicAttention;
use Tests\TestCase;

uses(TestCase::class);

beforeEach(function () {
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('b', 32)));
    config()->set('edna.subject_id', '2423');
});

class BenefitsCaseReadFake extends EdnaBitrix
{
    public array $calls = [];

    public array $dialog = ['id' => 601, 'entity_type' => 'LINES',
        'entity_id' => 'whatsappbyedna|1|5493510000000@2423|999',
        'entity_data_1' => 'Y|DEAL|900|N|N|501|1794333600|0|0|0',
        'entity_data_2' => 'LEAD|0|CONTACT|800|COMPANY|0|DEAL|900', 'owner' => 74827, 'text_field_enabled' => true];

    public array $records = [
        'deal:900' => ['ID' => '900', 'ASSIGNED_BY_ID' => '117941', 'CATEGORY_ID' => '15',
            'CONTACT_ID' => '800', 'LEAD_ID' => '0', 'COMPANY_ID' => '0', 'STAGE_ID' => 'C15:PREPARATION',
            'STAGE_SEMANTIC_ID' => 'P', 'CLOSED' => 'N'],
        'contact:800' => ['ID' => '800', 'ASSIGNED_BY_ID' => '29', 'CREATED_BY_ID' => '57',
            'UF_CRM_65B7E48033FCD' => '20123456789', 'NAME' => 'Synthetic private person'],
    ];

    public array $activity = ['ID' => '600', 'PROVIDER_ID' => 'IMOPENLINES_SESSION', 'ASSOCIATED_ENTITY_ID' => '501',
        'OWNER_TYPE_ID' => '2', 'OWNER_ID' => '900', 'PROVIDER_PARAMS' => ['USER_CODE' => 'whatsappbyedna|1|5493510000000@2423|999']];

    public ?Closure $beforeCall = null;

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = [$method, $payload];
        if ($this->beforeCall) {
            ($this->beforeCall)($method, $payload);
        }
        if ($method === 'imopenlines.dialog.get') {
            return $this->dialog;
        }
        if ($method === 'crm.activity.get') {
            return $this->activity;
        }
        if (preg_match('/^crm\.(lead|contact|company|deal)\.get$/D', $method, $match)) {
            return $this->records[$match[1].':'.$payload['id']] ?? null;
        }
        throw new RuntimeException('Unexpected write or discovery outside the native case.');
    }
}

class BenefitsCaseSnapshotFake extends EdnaOrganicAttention
{
    public array $value;

    public function __construct(array $snapshot)
    {
        $this->value = $snapshot;
    }

    public function snapshot(array $proof): array
    {
        return $this->value;
    }
}

function benefitsCaseProof(): array
{
    return ['verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'chat_id' => '601', 'session_id' => '501', 'message_id' => '500', 'activity_id' => '600', 'native_lead_id' => null];
}

function benefitsCaseResolve(BenefitsCaseReadFake $crm, ?array $proof = null): array
{
    return (new EdnaBenefitsCase($crm))->resolve($proof ?? benefitsCaseProof());
}

function benefitsCaseRehash(array $snapshot): array
{
    $snapshot['fingerprint'] = hash('sha256', json_encode(['version' => $snapshot['version'],
        'dialog_tuple' => $snapshot['dialog_tuple'], 'records' => $snapshot['records']], JSON_THROW_ON_ERROR));

    return $snapshot;
}

function benefitsCaseAddLead(BenefitsCaseReadFake $crm, string $owner = '117941', string $creator = '57'): array
{
    $crm->dialog['entity_data_2'] = 'LEAD|700|CONTACT|800|COMPANY|0|DEAL|900';
    $crm->records['deal:900']['LEAD_ID'] = '700';
    $crm->records['lead:700'] = ['ID' => '700', 'ASSIGNED_BY_ID' => $owner, 'CREATED_BY_ID' => $creator,
        'CONTACT_ID' => '800', 'STATUS_ID' => 'CONVERTED', 'STATUS_SEMANTIC_ID' => 'S', 'UF_CRM_1693840106704' => '20123456789'];

    return array_replace(benefitsCaseProof(), ['native_lead_id' => '700']);
}

test('the exact active native benefits deal uses its current CRM responsible without contact owner override', function () {
    $crm = new BenefitsCaseReadFake;
    $result = benefitsCaseResolve($crm);
    expect($result)->toMatchArray(['status' => 'benefits', 'reason' => 'native_active_benefits_case', 'chat_id' => '601', 'session_id' => '501',
        'case' => ['deal_id' => '900', 'category_id' => '15', 'contact_id' => '800', 'lead_id' => '',
            'responsible_id' => '117941', 'stage' => 'C15:PREPARATION', 'closed' => 'N']]);
    expect($result['snapshot']['dialog_tuple']['primary_entity'])->toBe('deal')
        ->and($result['snapshot']['records'])->toHaveCount(2)
        ->and(json_encode($result))->not->toContain('Synthetic private person', '20123456789', '5493510000000');
    foreach ($crm->calls as [$method]) {
        expect($method)->toBeIn(['imopenlines.dialog.get', 'crm.deal.get', 'crm.contact.get', 'crm.activity.get']);
    }
});

test('the responsible is read from CRM and is never hardcoded as Victoria or Tincho', function (string $responsible) {
    $crm = new BenefitsCaseReadFake;
    $crm->records['deal:900']['ASSIGNED_BY_ID'] = $responsible;
    expect(benefitsCaseResolve($crm)['case']['responsible_id'])->toBe($responsible);
    expect(array_filter($crm->calls, fn ($call) => $call[0] === 'user.get'))->toBeEmpty();
})->with(['29', '71159', '5737']);

test('a native benefits binding is valid with a consistent contact or lead primary', function (string $entity) {
    $crm = new BenefitsCaseReadFake;
    $proof = benefitsCaseProof();
    $id = '800';
    if ($entity === 'LEAD') {
        $proof = benefitsCaseAddLead($crm);
        $id = '700';
    }
    $crm->dialog['entity_data_1'] = 'Y|'.$entity.'|'.$id.'|N|N|501|1794333600|0|0|0';
    expect(benefitsCaseResolve($crm, $proof)['status'])->toBe('benefits');
})->with(['CONTACT', 'LEAD']);

test('the native benefit may lack CUIL without asking a credit form to recognize its purpose', function () {
    $crm = new BenefitsCaseReadFake;
    unset($crm->records['contact:800']['UF_CRM_65B7E48033FCD']);
    expect(benefitsCaseResolve($crm)['status'])->toBe('benefits');
});

test('a chat-only decision follows its benefits deal and keeps all historical owners intact', function (bool $origin) {
    $crm = new BenefitsCaseReadFake;
    $proof = benefitsCaseAddLead($crm, '71159', '71283');
    if (! $origin) {
        $crm->records['deal:900']['LEAD_ID'] = '0';
        $crm->records['contact:800']['LEAD_ID'] = '700';
    }
    $crm->dialog['entity_data_2'] = 'LEAD|0|CONTACT|800|COMPANY|0|DEAL|900';
    $proof['native_lead_id'] = null;
    $service = new EdnaBenefitsCase($crm);
    $original = $crm->records;
    expect($service->resolve($proof)['status'])->toBe('review');
    $before = $service->resolveUnified($proof);
    expect($before['status'])->toBe('benefits')->and($before['case']['responsible_id'])->toBe('117941')
        ->and($service->compatible($before, $service->resolveUnified($proof)))->toBeTrue();
    $crm->dialog['owner'] = 117941;
    expect($service->compatible($before, $service->resolveUnified($proof), true))->toBeTrue()
        ->and($crm->records)->toBe($original);
    $crm->records['lead:700']['ASSIGNED_BY_ID'] = '117941';
    expect($service->compatible($before, $service->resolveUnified($proof), true))->toBeFalse();
})->with(['91943 historical lead owner' => [true], '133797 extra lead of the same contact' => [false]]);

test('a historical lead cannot authorize the benefits deal for a different or unproved person', function (string $conflict) {
    $crm = new BenefitsCaseReadFake;
    $proof = benefitsCaseAddLead($crm, '71159', '71283');
    $crm->records['deal:900']['LEAD_ID'] = '0';
    $crm->records['contact:800']['LEAD_ID'] = '700';
    if ($conflict === 'different identity') {
        $crm->records['lead:700']['UF_CRM_1693840106704'] = '20999999999';
    } else {
        $crm->records['lead:700']['CONTACT_ID'] = $conflict === 'unproved contact' ? '0' : '810';
        $crm->records['contact:810'] = array_replace($crm->records['contact:800'], ['ID' => '810']);
    }
    expect((new EdnaBenefitsCase($crm))->resolveUnified($proof)['status'])->toBe('review');
})->with(['different identity', 'different contact', 'unproved contact']);

test('a primary deal from another category is not replaced by a phone search for benefits', function () {
    $crm = new BenefitsCaseReadFake;
    $crm->records['deal:900']['CATEGORY_ID'] = '1';
    $crm->records['deal:900']['STAGE_ID'] = 'C1:NEW';
    expect(benefitsCaseResolve($crm))->toMatchArray(['status' => 'not_applicable', 'reason' => 'native_case_other_category', 'case' => null]);
    foreach ($crm->calls as [$method]) {
        expect($method)->not->toContain('.list', 'duplicate');
    }
    expect($crm->calls)->toHaveCount(4)
        ->and(array_filter($crm->calls, fn ($call) => $call[0] === 'crm.activity.get'))->toBeEmpty()
        ->and(array_values(array_filter($crm->calls, fn ($call) => $call[0] === 'crm.deal.get')))->toHaveCount(1);
});

test('the final independent check sees a new benefits category instead of caching not applicable', function () {
    $crm = new BenefitsCaseReadFake;
    $crm->records['deal:900']['CATEGORY_ID'] = '1';
    $crm->records['deal:900']['STAGE_ID'] = 'C1:NEW';
    $service = new EdnaBenefitsCase($crm);
    expect($service->resolve(benefitsCaseProof())['status'])->toBe('not_applicable');
    $crm->records['deal:900']['CATEGORY_ID'] = '15';
    $crm->records['deal:900']['STAGE_ID'] = 'C15:PREPARATION';
    expect($service->resolve(benefitsCaseProof())['status'])->toBe('benefits')
        ->and(array_values(array_filter($crm->calls, fn ($call) => $call[0] === 'crm.activity.get')))->toHaveCount(1)
        ->and(array_values(array_filter($crm->calls, fn ($call) => $call[0] === 'crm.deal.get')))->toHaveCount(3);
});

test('an unverified category never takes the cheaper not applicable path', function (string $category) {
    $crm = new BenefitsCaseReadFake;
    $crm->records['deal:900']['CATEGORY_ID'] = $category;
    expect(benefitsCaseResolve($crm)['status'])->toBe('review');
})->with(['', 'unknown', '15.0', '-1']);

test('no native deal cannot select another management by contact or phone', function () {
    $crm = new BenefitsCaseReadFake;
    $crm->dialog['entity_data_1'] = 'Y|CONTACT|800|N|N|501|1794333600';
    $crm->dialog['entity_data_2'] = 'CONTACT|800|DEAL|0';
    expect(benefitsCaseResolve($crm))->toMatchArray(['status' => 'not_applicable', 'reason' => 'native_benefits_case_absent']);
    expect(array_filter($crm->calls, fn ($call) => ! in_array($call[0], ['imopenlines.dialog.get', 'crm.contact.get'], true)))->toBeEmpty();
});

test('closed coherent benefits cases do not block a genuinely new inquiry', function (string $semantic) {
    $crm = new BenefitsCaseReadFake;
    $crm->records['deal:900'] = array_replace($crm->records['deal:900'], ['CLOSED' => 'Y', 'STAGE_SEMANTIC_ID' => $semantic]);
    expect(benefitsCaseResolve($crm))->toMatchArray(['status' => 'not_applicable', 'reason' => 'native_benefits_case_closed']);
})->with(['S', 'F']);

test('a manual lead owner is preserved while only proved native provisional leads are eligible', function (string $owner, string $creator, bool $native, string $status) {
    $crm = new BenefitsCaseReadFake;
    $proof = benefitsCaseAddLead($crm, $owner, $creator);
    if (! $native) {
        $proof['native_lead_id'] = null;
    }
    expect(benefitsCaseResolve($crm, $proof)['status'])->toBe($status);
})->with([
    ['29', '29', true, 'review'], ['57', '29', true, 'review'], ['71283', '71283', true, 'review'],
    ['57', '57', true, 'benefits'], ['74827', '74827', true, 'benefits'], ['0', '', true, 'benefits'],
    ['57', '57', false, 'review'], ['117941', '29', false, 'benefits'],
]);

test('native provider activity must refer to the exact case session and connector source', function (string $change) {
    $crm = new BenefitsCaseReadFake;
    match ($change) {
        'id' => $crm->activity['ID'] = '601',
        'provider' => $crm->activity['PROVIDER_ID'] = 'OTHER',
        'session' => $crm->activity['ASSOCIATED_ENTITY_ID'] = '502',
        'owner' => $crm->activity['OWNER_ID'] = '901',
        'owner_type' => $crm->activity['OWNER_TYPE_ID'] = '4',
        'user_code' => $crm->activity['PROVIDER_PARAMS']['USER_CODE'] .= '-different',
        'params' => $crm->activity['PROVIDER_PARAMS'] = [],
    };
    expect(benefitsCaseResolve($crm)['status'])->toBe('review');
})->with(['id', 'provider', 'session', 'owner', 'owner_type', 'user_code', 'params']);

test('a session activity can retain its exact native lead or contact owner', function (string $entityType, string $id) {
    $crm = new BenefitsCaseReadFake;
    $proof = benefitsCaseProof();
    if ($entityType === '1') {
        $proof = benefitsCaseAddLead($crm);
    }
    $crm->activity = array_replace($crm->activity, ['OWNER_TYPE_ID' => $entityType, 'OWNER_ID' => $id]);
    expect(benefitsCaseResolve($crm, $proof)['status'])->toBe('benefits');
})->with([['1', '700'], ['3', '800']]);

test('malformed changed and inconsistent native CRM data fails closed', function (string $change) {
    $crm = new BenefitsCaseReadFake;
    $proof = benefitsCaseProof();
    match ($change) {
        'closed_absent' => $crm->records['deal:900'] = array_diff_key($crm->records['deal:900'], ['CLOSED' => true]),
        'category_absent' => $crm->records['deal:900'] = array_diff_key($crm->records['deal:900'], ['CATEGORY_ID' => true]),
        'stage_absent' => $crm->records['deal:900']['STAGE_ID'] = '',
        'stage_category' => $crm->records['deal:900']['STAGE_ID'] = 'C1:NEW',
        'semantic_absent' => $crm->records['deal:900'] = array_diff_key($crm->records['deal:900'], ['STAGE_SEMANTIC_ID' => true]),
        'contradictory_closed' => $crm->records['deal:900']['CLOSED'] = 'Y',
        'contradictory_open' => $crm->records['deal:900']['STAGE_SEMANTIC_ID'] = 'S',
        'owner_absent' => $crm->records['deal:900'] = array_diff_key($crm->records['deal:900'], ['ASSIGNED_BY_ID' => true]),
        'owner_zero' => $crm->records['deal:900']['ASSIGNED_BY_ID'] = '0',
        'contact' => $crm->records['deal:900']['CONTACT_ID'] = '801',
        'person_absent' => $crm->records['deal:900']['CONTACT_ID'] = '0',
        'proof_session' => $proof['session_id'] = '502',
        'proof_chat' => $proof['chat_id'] = '602',
        'proof_unverified' => $proof['verified'] = false,
        'proof_activity_absent' => $proof['activity_id'] = null,
        'native_deal_conflict' => $crm->dialog['entity_data_2'] = 'DEAL|901|CONTACT|800',
    };
    expect(benefitsCaseResolve($crm, $proof)['status'])->toBe('review');
})->with(['closed_absent', 'category_absent', 'stage_absent', 'stage_category', 'semantic_absent', 'contradictory_closed',
    'contradictory_open', 'owner_absent', 'owner_zero', 'contact', 'person_absent', 'proof_session', 'proof_chat',
    'proof_unverified', 'proof_activity_absent', 'native_deal_conflict']);

test('conflicting known lead and contact identities never choose one person', function () {
    $crm = new BenefitsCaseReadFake;
    $proof = benefitsCaseAddLead($crm);
    $crm->records['lead:700']['UF_CRM_1693840106704'] = '20999999999';
    expect(benefitsCaseResolve($crm, $proof)['status'])->toBe('review');
});

test('multiple or incomplete native snapshot records cannot authorize benefits routing', function (string $change) {
    $crm = new BenefitsCaseReadFake;
    $snapshot = (new EdnaOrganicAttention($crm))->snapshot(benefitsCaseProof());
    match ($change) {
        'duplicate' => $snapshot['records'][] = $snapshot['records'][0],
        'another_deal' => $snapshot['records'][] = array_replace($snapshot['records'][1], ['entity' => 'deal', 'id' => '901']),
        'missing_deal' => $snapshot['records'] = [$snapshot['records'][0]],
        'missing_owner' => $snapshot['records'][0] = array_diff_key($snapshot['records'][0], ['owner' => true]),
    };
    $attention = new BenefitsCaseSnapshotFake(benefitsCaseRehash($snapshot));
    expect((new EdnaBenefitsCase($crm, $attention))->resolve(benefitsCaseProof())['status'])->toBe('review');
})->with(['duplicate', 'another_deal', 'missing_deal', 'missing_owner']);

test('a case owner or stage changing after the snapshot is not attributed to the earlier case', function (string $change) {
    $crm = new BenefitsCaseReadFake;
    $reads = 0;
    $crm->beforeCall = function ($method) use ($crm, &$reads, $change) {
        if ($method === 'crm.deal.get' && ++$reads === 2) {
            $crm->records['deal:900'][$change] = $change === 'ASSIGNED_BY_ID' ? '29' : 'C15:OTHER';
        }
    };
    expect(benefitsCaseResolve($crm)['status'])->toBe('review');
})->with(['ASSIGNED_BY_ID', 'STAGE_ID']);

test('compatibility before transfer requires exact case identity CRM state and native tuple', function (string $change) {
    $crm = new BenefitsCaseReadFake;
    $service = new EdnaBenefitsCase($crm);
    $before = $service->resolve(benefitsCaseProof());
    match ($change) {
        'same' => null,
        'owner' => $crm->records['deal:900']['ASSIGNED_BY_ID'] = '29',
        'contact_owner' => $crm->records['contact:800']['ASSIGNED_BY_ID'] = '57',
        'stage' => $crm->records['deal:900']['STAGE_ID'] = 'C15:OTHER',
        'chat_owner' => $crm->dialog['owner'] = 57,
        'closed' => $crm->records['deal:900']['CLOSED'] = 'Y',
        'reopened' => $crm->dialog['entity_data_1'] = str_replace('|501|', '|502|', $crm->dialog['entity_data_1']),
    };
    expect($service->compatible($before, $service->resolve(benefitsCaseProof())))->toBe($change === 'same');
})->with(['same', 'owner', 'contact_owner', 'stage', 'chat_owner', 'closed', 'reopened']);

test('post transfer compatibility permits only the expected chat owner change', function (int $ownerBefore, int $ownerAfter, bool $allowed) {
    $crm = new BenefitsCaseReadFake;
    $crm->dialog['owner'] = $ownerBefore;
    $service = new EdnaBenefitsCase($crm);
    $before = $service->resolve(benefitsCaseProof());
    $crm->dialog['owner'] = $ownerAfter;
    expect($service->compatible($before, $service->resolve(benefitsCaseProof()), true))->toBe($allowed);
})->with([[0, 117941, true], [57, 117941, true], [74827, 117941, true], [117941, 117941, true],
    [29, 117941, false], [74827, 29, false], [74827, 74827, false]]);

test('post transfer permits only the native provisional lead alignment among CRM responsibles', function (string $record, bool $allowed) {
    $crm = new BenefitsCaseReadFake;
    $proof = benefitsCaseAddLead($crm, '57', '57');
    $service = new EdnaBenefitsCase($crm);
    $before = $service->resolve($proof);
    $crm->dialog['owner'] = 117941;
    $crm->records[$record]['ASSIGNED_BY_ID'] = '117941';
    expect($service->compatible($before, $service->resolve($proof), true))->toBe($allowed);
})->with([['lead:700', true], ['contact:800', false]]);

test('a native provisional lead may remain unchanged after only the chat was transferred', function () {
    $crm = new BenefitsCaseReadFake;
    $proof = benefitsCaseAddLead($crm, '57', '57');
    $service = new EdnaBenefitsCase($crm);
    $before = $service->resolve($proof);
    $crm->dialog['owner'] = 117941;
    expect($service->compatible($before, $service->resolve($proof), true))->toBeTrue();
});

test('tampered persisted results and malformed snapshots fail compatibility without HTTP reads', function () {
    $crm = new BenefitsCaseReadFake;
    $service = new EdnaBenefitsCase($crm);
    $before = $service->resolve(benefitsCaseProof());
    $crm->calls = [];
    $after = $before;
    $after['case']['responsible_id'] = '5737';
    expect($service->compatible($before, $after))->toBeFalse();
    $after = $before;
    $after['snapshot']['dialog_tuple']['owner'] = '117941';
    expect($service->compatible($before, $after, true))->toBeFalse()->and($crm->calls)->toBeEmpty();
});

test('a persisted case cannot claim a deal absent from its native primary and bindings', function () {
    $crm = new BenefitsCaseReadFake;
    $service = new EdnaBenefitsCase($crm);
    $forged = $service->resolve(benefitsCaseProof());
    $forged['snapshot']['dialog_tuple']['primary_entity'] = 'contact';
    $forged['snapshot']['dialog_tuple']['primary_id'] = '800';
    unset($forged['snapshot']['dialog_tuple']['bindings']['deal']);
    $forged['snapshot'] = benefitsCaseRehash($forged['snapshot']);
    $crm->calls = [];
    expect($service->compatible($forged, $forged))->toBeFalse()->and($crm->calls)->toBeEmpty();
});

test('a different related record count never authorizes post transfer compatibility', function () {
    $crm = new BenefitsCaseReadFake;
    $service = new EdnaBenefitsCase($crm);
    $before = $service->resolve(benefitsCaseProof());
    $after = $before;
    $after['snapshot']['records'][] = array_replace($after['snapshot']['records'][0], ['entity' => 'company', 'id' => '901', 'identity_hash' => null]);
    $after['snapshot']['dialog_tuple']['owner'] = '117941';
    $after['snapshot'] = benefitsCaseRehash($after['snapshot']);
    expect($service->compatible($before, $after, true))->toBeFalse();
});

test('provider errors do not expose credentials private text or partial eligibility', function () {
    $crm = new BenefitsCaseReadFake;
    $crm->beforeCall = fn () => throw new RuntimeException('https://private.invalid/rest/1/credential private-person');
    $result = benefitsCaseResolve($crm);
    expect($result)->toMatchArray(['status' => 'review', 'case' => null, 'snapshot' => null])
        ->and(json_encode($result))->not->toContain('credential', 'private-person', 'private.invalid');
});
