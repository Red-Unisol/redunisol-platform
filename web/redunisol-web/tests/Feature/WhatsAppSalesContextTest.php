<?php

use App\Services\WhatsAppSalesContext;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 10, 5)->setTime(22, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('a', 32)));
    config()->set('edna.bitrix_url', 'https://redunisol.bitrix24.es/rest/1/testkey/');
    Http::preventStrayRequests();
});

function salesContextHttp(array $data): void
{
    Http::fake(['redunisol.bitrix24.es/*' => function ($r) use ($data) {
        $method = basename($r->url(), '.json');
        $result = match ($method) {
            'crm.duplicate.findbycomm' => $r['entity_type'] === 'CONTACT' ? ['CONTACT' => $data['contact_ids'] ?? ['123']] : ['LEAD' => $data['lead_ids'] ?? []],
            'crm.contact.get' => ['ID' => (string) $r['id'], 'NAME' => 'Ana', 'PHONE' => [['VALUE' => $data['record_phone'] ?? '+54 351 1234567']]],
            'crm.lead.get' => $data['direct_lead'] ?? ['ID' => (string) $r['id'], 'NAME' => 'Ana', 'PHONE' => [['VALUE' => '+54 351 1234567']]],
            'crm.deal.list' => array_map(fn ($d) => $d + ['CONTACT_ID' => '123', 'CATEGORY_ID' => '1', 'STAGE_SEMANTIC_ID' => 'P'], $data['deals'] ?? []),
            'crm.lead.list' => $data['leads'] ?? [],
            'imopenlines.crm.chat.get' => $data['chats'] ?? [],
            'im.dialog.get' => ['entity_id' => $data['chat_channel'] ?? 'whatsappbyedna|1|phone'],
            'im.dialog.messages.get' => ['chat_id' => 789, 'messages' => $data['messages'] ?? [], 'users' => $data['chat_users'] ?? []],
            'user.get' => [['ID' => (string) $r['ID'], 'NAME' => 'Maru', 'ACTIVE' => true, 'UF_DEPARTMENT' => $data['departments'] ?? [1], 'EXTERNAL_AUTH_ID' => $data['external_auth'] ?? '']],
            default => throw new RuntimeException('Unexpected method '.$method),
        };

        return Http::response(['result' => $result]);
    }]);
}

function salesFormLead(array $overrides = []): array
{
    return array_replace(['ID' => '456', 'CONTACT_ID' => '123', 'DATE_CREATE' => now()->subDays(20)->toIso8601String(),
        'STATUS_SEMANTIC_ID' => 'P', 'ASSIGNED_BY_ID' => '57', 'UF_CRM_ATTR_JSON' => '{"version":1}'], $overrides);
}

test('an open Sales deal identifies management and its assigned advisor', function () {
    salesContextHttp(['deals' => [['ID' => '1', 'ASSIGNED_BY_ID' => '57']]]);
    $context = (new WhatsAppSalesContext)->resolve('5493511234567');
    expect($context['managed'])->toBeTrue()->and($context['name'])->toBe('Ana')
        ->and($context['advisor_name'])->toBe('Maru')->and($context['advisor_id'])->toBe(57);
    Http::assertSent(fn ($r) => str_contains($r->url(), 'crm.deal.list')
        && $r['filter']['=CATEGORY_ID'] === 1 && $r['filter']['=STAGE_SEMANTIC_ID'] === 'P'
        && $r['filter']['@CONTACT_ID'] === ['123']);
});

test('a recent form lead is management, including submissions before attribution existed', function (bool $legacy) {
    $lead = salesFormLead();
    if ($legacy) {
        unset($lead['UF_CRM_ATTR_JSON']);
        $lead += ['UF_CRM_COMM_OWNER' => 'Kestra', 'UF_CRM_1693840106704' => '20123456789',
            'UF_CRM_1714071903' => '1', 'UF_CRM_64E65D2B2136C' => '2', 'UF_CRM_1722365051' => '2423'];
    }
    salesContextHttp(['leads' => [$lead]]);
    expect((new WhatsAppSalesContext)->resolve('5493511234567')['managed'])->toBeTrue();
})->with([true, false]);

test('lost, old and non-form leads do not establish management', function (string $case) {
    $lead = match ($case) {
        'lost' => salesFormLead(['STATUS_SEMANTIC_ID' => 'F']),
        'old' => salesFormLead(['DATE_CREATE' => now()->subDays(61)->toIso8601String()]),
        default => salesFormLead(['UF_CRM_ATTR_JSON' => null]),
    };
    salesContextHttp(['leads' => [$lead]]);
    expect((new WhatsAppSalesContext)->resolve('5493511234567')['managed'])->toBeFalse();
})->with(['lost', 'old', 'non_form']);

test('a verified employee message in a Sales chat in the last thirty days establishes management', function () {
    salesContextHttp(['chats' => [['CHAT_ID' => 789]], 'messages' => [[
        'id' => 1, 'author_id' => 57, 'date' => now()->subDays(29)->toIso8601String(), 'text' => 'Hola Ana',
    ]]]);
    expect((new WhatsAppSalesContext)->resolve('5493511234567')['managed'])->toBeTrue();
});

test('client, bot, system, old and other-line messages are not advisor evidence', function (string $case) {
    $data = ['chats' => [['CHAT_ID' => 789]], 'messages' => [[
        'id' => 1, 'author_id' => 57, 'date' => now()->subDays(29)->toIso8601String(), 'text' => 'Hola',
    ]]];
    if ($case === 'client') {
        $data['departments'] = [];
    }
    if ($case === 'bot') {
        $data['chat_users'] = [['id' => 57, 'bot' => true]];
    }
    if ($case === 'system') {
        $data['messages'][0]['author_id'] = 0;
    }
    if ($case === 'old') {
        $data['messages'][0]['date'] = now()->subDays(31)->toIso8601String();
    }
    if ($case === 'other_line') {
        $data['chat_channel'] = 'whatsappbyedna|3|phone';
    }
    salesContextHttp($data);
    expect((new WhatsAppSalesContext)->resolve('5493511234567')['managed'])->toBeFalse();
})->with(['client', 'bot', 'system', 'old', 'other_line']);

test('duplicate contacts keep management but omit personalized names', function () {
    salesContextHttp(['contact_ids' => ['123', '124'], 'deals' => [['ID' => '1', 'ASSIGNED_BY_ID' => '57']]]);
    $context = (new WhatsAppSalesContext)->resolve('5493511234567');
    expect($context['managed'])->toBeTrue()->and($context['name'])->toBeNull()->and($context)->not->toHaveKey('advisor_name');
});

test('different assigned advisors omit the advisor name', function () {
    salesContextHttp(['deals' => [['ID' => '1', 'ASSIGNED_BY_ID' => '57'], ['ID' => '2', 'ASSIGNED_BY_ID' => '58']]]);
    expect((new WhatsAppSalesContext)->resolve('5493511234567'))->not->toHaveKey('advisor_name');
});

test('a CRM phone mismatch cannot bind another persons context', function () {
    salesContextHttp(['record_phone' => '+54 351 9999999']);
    $context = (new WhatsAppSalesContext)->resolve('5493511234567');
    expect($context['managed'])->toBeFalse()->and($context['name'])->toBeNull();
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'crm.deal.list'));
});

test('no matching CRM records produces the general notice context', function () {
    salesContextHttp(['contact_ids' => []]);
    expect((new WhatsAppSalesContext)->resolve('5493511234567')['managed'])->toBeFalse();
});

test('CRM failure is retriable and never silently classifies the person as general', function () {
    Http::fake(['redunisol.bitrix24.es/*' => Http::response(['error' => 'insufficient_scope'], 200)]);
    expect(fn () => (new WhatsAppSalesContext)->resolve('5493511234567'))->toThrow(RuntimeException::class);
});

test('a server response that ignores ownership filtering is rejected', function () {
    salesContextHttp(['deals' => [['ID' => '1', 'CONTACT_ID' => '999', 'ASSIGNED_BY_ID' => '57']]]);
    expect(fn () => (new WhatsAppSalesContext)->resolve('5493511234567'))->toThrow(RuntimeException::class);
});
