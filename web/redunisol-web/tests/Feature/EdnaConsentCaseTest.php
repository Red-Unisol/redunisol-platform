<?php

use App\Services\EdnaBitrix;
use App\Services\EdnaConsentCase;
use App\Services\EdnaOrganicAttention;

function consentCaseFixture(): array
{
    config(['app.key' => 'consent-proof-test', 'edna.subject_id' => '44']);
    $code = 'whatsappbyedna|1|5491100001000@44|7';
    $proof = ['verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'chat_id' => '71', 'session_id' => '72', 'activity_id' => '73', 'message_id' => '74', 'entry_message_id' => '75'];
    $payload = ['id' => 75, 'subjectId' => '44', 'replyOutMessageId' => 99, 'subscriber' => ['identifier' => '5491100001000']];
    $outbound = ['messageId' => '99', 'subjectId' => '44', 'matcherId' => '58478', 'uniqueAroundSend' => true,
        'sentOrReceivedAt' => '2026-11-25T12:19:43.150Z'];
    $send = ['ID' => '81', 'OWNER_TYPE_ID' => '2', 'OWNER_ID' => '60', 'DIRECTION' => '2', 'CREATED' => '2026-11-25T15:19:42+03:00',
        'PROVIDER_ID' => 'CRM_WHATSAPP', 'PROVIDER_TYPE_ID' => 'WHATSAPP', 'ASSOCIATED_ENTITY_ID' => '82',
        'SETTINGS' => ['ORIGINAL_TEMPLATE_ID' => '58478', 'ORIGINAL_MESSAGE' => ['ID' => '82', 'SENDER_ID' => 'ednaru',
            'MESSAGE_FROM' => '44', 'MESSAGE_TO' => '+5491100001000']]];
    $deal = ['ID' => '60', 'CONTACT_ID' => '61', 'LEAD_ID' => '62', 'STAGE_ID' => 'C1:UC_ZH5DGU',
        'ASSIGNED_BY_ID' => '63', 'CATEGORY_ID' => '1', 'STAGE_SEMANTIC_ID' => 'P', 'CLOSED' => 'N'];
    $results = ['crm.activity.list' => [$send], 'crm.activity.get' => ['ID' => '73', 'PROVIDER_ID' => 'IMOPENLINES_SESSION',
        'ASSOCIATED_ENTITY_ID' => '72', 'OWNER_TYPE_ID' => '2', 'OWNER_ID' => '60', 'PROVIDER_PARAMS' => ['USER_CODE' => $code]],
        'crm.deal.get' => $deal, 'crm.deal.list' => [$deal]];
    $tuple = ['chat_id' => '71', 'session_id' => '72', 'bindings' => ['contact' => '61', 'deal' => '60'],
        'primary_entity' => 'deal', 'primary_id' => '60', 'source_hash' => hash_hmac('sha256', 'organic-source:'.$code, config('app.key'))];

    return compact('proof', 'payload', 'outbound', 'results', 'tuple');
}

function consentCaseResolve(array $f, ?string $action = null): ?array
{
    $crm = Mockery::mock(EdnaBitrix::class);
    $crm->shouldReceive('call')->andReturnUsing(function (string $method, array $args) use ($f) {
        if ($method === 'crm.activity.list') {
            expect($args['filter'])->toHaveKey('>=CREATED')->toHaveKey('<=CREATED')->not->toHaveKey('OWNER_ID');
        }
        if ($method === 'crm.deal.list' && isset($args['filter']['=LEAD_ID'])) {
            return $f['lead_deals'];
        }
        if ($method === 'crm.duplicate.findbycomm') {
            return $f['duplicates'][$args['entity_type']];
        }
        if ($method === 'crm.lead.list' && isset($args['filter']['@ID'])) {
            return $f['phone_open_leads'];
        }
        if ($method === 'crm.deal.list' && isset($args['filter']['@LEAD_ID'])) {
            return $f['phone_open_deals'];
        }

        return $f['results'][$method];
    });
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('snapshot')->with($f['proof'])->andReturn(['dialog_tuple' => $f['tuple']]);

    $service = new EdnaConsentCase($crm, $attention);

    return $action === null ? $service->resolve($f['proof'], $f['payload'], $f['outbound'])
        : $service->campaign($f['proof'], $f['payload'], ['action' => $action, 'outbound' => $f['outbound']]);
}

it('recovers the seller in RESPUESTA from the outgoing and incoming activities of the same deal', function () {
    $f = consentCaseFixture();
    $other = $f['results']['crm.activity.list'][0];
    $other['SETTINGS']['ORIGINAL_MESSAGE']['MESSAGE_TO'] = '+5491100001001';
    $f['results']['crm.activity.list'][] = $other;
    $case = consentCaseResolve($f);
    expect($case)->toMatchArray(['ID' => '60', 'ASSIGNED_BY_ID' => '63', 'STAGE_ID' => 'C1:UC_ZH5DGU',
        'consent_activity_id' => '81', 'consent_provider_message_id' => '82', 'consent_out_message_id' => '99'])
        ->and(json_encode($case))->not->toContain('5491100001000');
});

it('requires positive independent proof at the provider, at emission and in the current session', function (string $scenario) {
    $f = consentCaseFixture();
    switch ($scenario) {
        case 'duplicate-crm':
            $other = $f['results']['crm.activity.list'][0];
            $other['OWNER_ID'] = '91';
            $other['SETTINGS']['ORIGINAL_MESSAGE']['MESSAGE_TO'] = '+54 (11) 0000-1000';
            $f['results']['crm.activity.list'][] = $other;
            break;
        case 'duplicate-edna': $f['outbound']['uniqueAroundSend'] = false; break;
        case 'unrelated-outbound': $f['payload']['replyOutMessageId'] = 98; break;
        case 'wrong-incoming-activity': $f['results']['crm.activity.get']['OWNER_ID'] = '91'; break;
        case 'contact-only-activity': $f['results']['crm.activity.get']['OWNER_TYPE_ID'] = '3'; break;
        case 'another-session': $f['results']['crm.activity.get']['ASSOCIATED_ENTITY_ID'] = '91'; break;
        case 'another-subject': $f['results']['crm.activity.list'][0]['SETTINGS']['ORIGINAL_MESSAGE']['MESSAGE_FROM'] = '45'; break;
        case 'wrong-template': $f['results']['crm.activity.list'][0]['SETTINGS']['ORIGINAL_TEMPLATE_ID'] = '58749'; break;
        case 'wrong-bitrix-sms': $f['results']['crm.activity.list'][0]['ASSOCIATED_ENTITY_ID'] = '99'; break;
        case 'wrong-time': $f['results']['crm.activity.list'][0]['CREATED'] = '2026-11-25T15:19:25+03:00'; break;
        case 'changed-binding': $f['tuple']['bindings']['deal'] = '91'; break;
        case 'inactive': $f['results']['crm.deal.get']['CLOSED'] = 'Y'; break;
        case 'queue': $f['results']['crm.deal.get']['STAGE_ID'] = 'C1:KESTRA_QUEUE'; break;
        case 'review': $f['results']['crm.deal.get']['STAGE_ID'] = 'C1:KESTRA_ROUTE_REVIEW'; break;
        case 'benefits': $f['results']['crm.deal.get']['CATEGORY_ID'] = '15'; break;
        case 'default-owner': $f['results']['crm.deal.get']['ASSIGNED_BY_ID'] = '74827'; break;
        case 'multiple-open': $f['results']['crm.deal.list'][] = ['ID' => '91']; break;
        case 'seller-changed': $f['results']['crm.deal.list'][0]['ASSIGNED_BY_ID'] = '94'; break;
    }
    expect(consentCaseResolve($f))->toBeNull();
})->with(['duplicate-crm', 'duplicate-edna', 'unrelated-outbound', 'wrong-incoming-activity', 'contact-only-activity',
    'another-session', 'another-subject', 'wrong-template', 'wrong-bitrix-sms', 'wrong-time', 'changed-binding', 'inactive',
    'queue', 'review', 'benefits', 'default-owner', 'multiple-open', 'seller-changed']);

it('retries incomplete activity reads instead of treating a partial page as a unique send', function () {
    $f = consentCaseFixture();
    $f['results']['crm.activity.list'] = array_fill(0, 50, $f['results']['crm.activity.list'][0]);
    expect(fn () => consentCaseResolve($f))->toThrow(RuntimeException::class);
});

function campaignCaseFixture(string $owner = 'deal', string $action = 'continue'): array
{
    $f = consentCaseFixture();
    [$matcher, $name, $type, $text] = match ($action) {
        'offer' => ['63977', 'reactivacion_paii', 'BUTTON', 'Consultar disponible'],
        'clarify' => ['54655', 'ingreso_basico', 'TEXT', 'Tengo una pregunta'],
        default => ['58749', 'reingreso_consent', 'BUTTON', 'Sí, quiero asesoramiento'],
    };
    $f['payload']['messageContent'] = ['type' => $type, 'text' => $text, 'payload' => $text];
    $f['outbound']['matcherId'] = $matcher;
    $f['outbound']['matcherName'] = $name;
    $send = &$f['results']['crm.activity.list'][0];
    $send['SETTINGS']['ORIGINAL_TEMPLATE_ID'] = $matcher;
    if ($owner !== 'deal') {
        $id = $owner === 'lead' ? '62' : '61';
        $type = $owner === 'lead' ? '1' : '3';
        $f['tuple']['primary_entity'] = $owner;
        $f['tuple']['primary_id'] = $id;
        $f['tuple']['bindings'] = [$owner => $id, 'contact' => '61'];
        $send['OWNER_TYPE_ID'] = $type;
        $send['OWNER_ID'] = $id;
        $f['results']['crm.activity.get']['OWNER_TYPE_ID'] = $type;
        $f['results']['crm.activity.get']['OWNER_ID'] = $id;
    }
    $f['results']['crm.lead.get'] = ['ID' => '62', 'CONTACT_ID' => '61', 'STATUS_SEMANTIC_ID' => 'S'];
    $f['lead_deals'] = $f['results']['crm.deal.list'];
    $f['duplicates'] = ['CONTACT' => ['CONTACT' => [61]], 'LEAD' => ['LEAD' => [62]]];
    $f['results']['crm.lead.list'] = [];
    $f['phone_open_leads'] = $f['phone_open_deals'] = [];

    return $f;
}

it('resolves a verified campaign to its current seller through the originating deal or lead', function (string $entity, string $action) {
    $f = campaignCaseFixture($entity, $action);
    $result = consentCaseResolve($f, $action);
    expect($result['status'])->toBe('assigned')
        ->and($result['case'])->toMatchArray(['ID' => '60', 'ASSIGNED_BY_ID' => '63', 'consent_activity_id' => '81']);
})->with([['deal', 'continue'], ['lead', 'continue'], ['deal', 'clarify'], ['deal', 'offer']]);

it('rechecks the seller and resumes the same case after distribution without creating anything', function () {
    $f = campaignCaseFixture();
    $f['results']['crm.deal.get']['ASSIGNED_BY_ID'] = '74827';
    $f['results']['crm.deal.get']['STAGE_ID'] = 'C1:KESTRA_QUEUE';
    $f['results']['crm.deal.list'] = [$f['results']['crm.deal.get']];
    expect(consentCaseResolve($f, 'continue'))->toMatchArray(['status' => 'waiting_assignment', 'case' => null]);
    $f['results']['crm.deal.get']['ASSIGNED_BY_ID'] = '89';
    $f['results']['crm.deal.get']['STAGE_ID'] = 'C1:UC_ZH5DGU';
    $f['results']['crm.deal.list'] = [$f['results']['crm.deal.get']];
    expect(consentCaseResolve($f, 'continue')['case'])->toMatchArray(['ID' => '60', 'ASSIGNED_BY_ID' => '89']);
});

it('waits for conversion of the exact pending lead, even if another deal exists for the same phone', function () {
    $f = campaignCaseFixture('lead');
    $f['results']['crm.lead.get']['STATUS_SEMANTIC_ID'] = 'P';
    $f['lead_deals'] = [];
    expect(consentCaseResolve($f, 'continue'))->toMatchArray(['status' => 'waiting_assignment', 'reason' => 'campaign_lead_awaiting_deal', 'case' => null]);
});

it('never infers a seller from a contact, another lead, a closed deal or a business conflict', function (string $scenario) {
    $f = campaignCaseFixture($scenario === 'contact' ? 'contact' : 'deal');
    if ($scenario === 'other-lead') {
        $f['results']['crm.activity.list'][0]['OWNER_TYPE_ID'] = '1';
        $f['results']['crm.activity.list'][0]['OWNER_ID'] = '91';
    } elseif ($scenario === 'closed') {
        $f['results']['crm.deal.get']['CLOSED'] = 'Y';
        $f['results']['crm.deal.get']['STAGE_SEMANTIC_ID'] = 'F';
    } elseif ($scenario === 'multiple-open') {
        $f['results']['crm.deal.list'][] = ['ID' => '92'];
    } elseif ($scenario === 'emission-unverified') {
        $f['results']['crm.activity.list'] = [];
    }
    $result = consentCaseResolve($f, 'continue');
    expect($result)->toMatchArray(['status' => $scenario === 'closed' ? 'closed' : 'unverified', 'case' => null]);
})->with(['contact', 'other-lead', 'closed', 'multiple-open', 'emission-unverified']);

it('allows a new offer inquiry only after proving that this exact recipient has no reusable case', function (string $scenario, string $expected) {
    $f = campaignCaseFixture('contact', 'offer');
    $f['results']['crm.deal.list'] = [];
    switch ($scenario) {
        case 'provider-broadcast': $f['results']['crm.activity.list'] = []; break;
        case 'failed-read': $f['duplicates']['LEAD'] = ['error' => 'unavailable']; break;
        case 'duplicate-phone-contact': $f['duplicates']['CONTACT']['CONTACT'][] = '97'; break;
        case 'other-open-deal': $f['results']['crm.deal.list'] = [['ID' => '93']]; break;
        case 'other-open-lead': $f['results']['crm.lead.list'] = [['ID' => '94']]; break;
        case 'unlinked-lead': $f['phone_open_leads'] = [['ID' => '62']]; break;
        case 'unlinked-deal': $f['phone_open_deals'] = [['ID' => '95']]; break;
        case 'wrong-recipient':
            $f['results']['crm.activity.get']['PROVIDER_PARAMS']['USER_CODE'] = 'whatsappbyedna|1|5491100001001@44|7';
            break;
        case 'ambiguous-emission': $f['results']['crm.activity.list'][] = $f['results']['crm.activity.list'][0]; break;
    }
    if ($expected === 'retry') {
        expect(fn () => consentCaseResolve($f, 'offer'))->toThrow(RuntimeException::class);
    } else {
        expect(consentCaseResolve($f, 'offer'))->toMatchArray(['status' => $expected, 'case' => null]);
    }
})->with([
    ['contact-emission', 'no_active_case'], ['provider-broadcast', 'no_active_case'], ['failed-read', 'retry'],
    ['duplicate-phone-contact', 'unverified'], ['other-open-deal', 'unverified'], ['other-open-lead', 'unverified'],
    ['unlinked-lead', 'unverified'], ['unlinked-deal', 'unverified'], ['wrong-recipient', 'unverified'], ['ambiguous-emission', 'unverified'],
]);

it('does not reinterpret a declined button or a policy change on recheck', function () {
    $f = campaignCaseFixture('deal', 'offer');
    $f['payload']['messageContent'] = ['type' => 'BUTTON', 'text' => 'No me interesa', 'payload' => 'No me interesa'];
    expect(consentCaseResolve($f, 'offer'))->toMatchArray(['status' => 'unverified', 'case' => null]);
});

it('can ask a clarification for a verified broadcast without an open case', function () {
    $f = campaignCaseFixture('contact', 'clarify');
    $f['results']['crm.deal.list'] = $f['results']['crm.activity.list'] = [];
    expect(consentCaseResolve($f, 'clarify'))->toMatchArray(['status' => 'no_active_case', 'case' => null]);
});

it('distinguishes a converted lead from a rejection that conflicts with its still-open deal', function () {
    $f = campaignCaseFixture();
    $f['results']['crm.activity.list'][0]['OWNER_TYPE_ID'] = '1';
    $f['results']['crm.activity.list'][0]['OWNER_ID'] = '62';
    expect(consentCaseResolve($f, 'continue')['case'])->toMatchArray(['ID' => '60', 'ASSIGNED_BY_ID' => '63']);
    $f['results']['crm.lead.get']['STATUS_SEMANTIC_ID'] = 'F';
    expect(consentCaseResolve($f, 'continue'))->toMatchArray(['status' => 'unverified', 'case' => null]);
});
