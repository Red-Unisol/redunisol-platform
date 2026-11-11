<?php

use App\Services\AttributionJourney;
use App\Services\EdnaBitrix;
use App\Services\EdnaOrganicProfile;
use App\Services\WebFormReceipt;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-08-31T15:00:00Z'));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('p', 32)));
    config()->set('edna.subject_id', '2423');
    config()->set('edna.organic_profile_max_age_months', 6);
    Http::preventStrayRequests();
});

class OrganicProfileCrmFake extends EdnaBitrix
{
    public array $calls = [];

    public array $lead = ['ID' => '700', 'CONTACT_ID' => '0'];

    public array $duplicates = ['LEAD' => [], 'CONTACT' => []];

    public array $records = ['lead' => [], 'contact' => []];

    public array $getRecords = [];

    public array $schema = [
        'UF_CRM_64E65D2B2136C' => ['type' => 'enumeration', 'isMultiple' => false, 'items' => [['ID' => '101', 'VALUE' => 'Córdoba']]],
        'UF_CRM_1714071903' => ['type' => 'enumeration', 'isMultiple' => false, 'items' => [['ID' => '201', 'VALUE' => 'Empleado público provincial']]],
        'UF_CRM_LEAD_1711458190312' => ['type' => 'enumeration', 'isMultiple' => false, 'items' => [['ID' => '301', 'VALUE' => 'Banco de la Provincia de Córdoba S.A.']]],
    ];

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = [$method, $payload];

        return match ($method) {
            'crm.lead.get' => $this->getRecords[(string) $payload['id']] ?? $this->lead,
            'crm.lead.fields' => $this->schema,
            'crm.duplicate.findbycomm' => [$payload['entity_type'] => $this->duplicates[$payload['entity_type']]],
            'crm.lead.list' => $this->records['lead'],
            'crm.contact.list' => $this->records['contact'],
            default => throw new RuntimeException('Unexpected CRM mutation.'),
        };
    }
}

function organicSavedAnswer(array $changes = []): array
{
    return array_replace(['provincia' => 'cordoba', 'situacion_cordoba' => 'empleado_publico',
        'banco_cordoba' => 'bancor', 'cuil' => '20301234563', 'email' => 'Client@Example.test'], $changes);
}

function organicProfileMenu(): object
{
    return (object) ['recipient' => Crypt::encryptString('5493510000000'),
        'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'), 'subject_id' => '2423', 'choice_received_at' => now()];
}

function organicProfileProof(): array
{
    return ['verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'chat_id' => '601', 'session_id' => '501', 'native_lead_id' => '700'];
}

function organicSaveProfile(array $answer = [], mixed $confirmed = null): void
{
    $profile = new EdnaOrganicProfile;
    expect($profile->record('web_form', (string) Str::uuid(), '5493510000000', organicSavedAnswer($answer),
        $confirmed ?? now()->subMonth()->toIso8601String(), '900', '800'))->toBeTrue();
}

test('complete saved client declarations are reusable and retain their actual confirmation provenance', function () {
    organicSaveProfile();
    $crm = new OrganicProfileCrmFake;
    $result = (new EdnaOrganicProfile($crm))->resolve(organicProfileMenu(), organicProfileProof());
    expect($result)->toMatchArray(['status' => 'reusable', 'lead_id' => '900', 'contact_id' => '800'])
        ->and($result['answer'])->toMatchArray(['cuil' => '20301234563', 'email' => 'client@example.test'])
        ->and($result['provenance'])->toMatchArray(['source_kind' => 'web_form', 'schema' => 'whatsapp-intake-v3', 'v3_equivalent' => true])
        ->and($result['provenance']['confirmed_at'])->toBe(now()->subMonth()->utc()->toIso8601String())
        ->and($result['identity_hash'])->toBe((new WebFormReceipt)->identityHash('20301234563'));
    Http::assertNothingSent();
});

test('calendar month freshness uses no overflow and requires a declaration newer than the complete cutoff', function (string $date, string $status) {
    organicSaveProfile([], $date);
    expect((new EdnaOrganicProfile(new OrganicProfileCrmFake))->resolve(organicProfileMenu(), organicProfileProof())['status'])->toBe($status);
})->with([
    ['2026-02-28T15:00:01Z', 'reusable'], ['2026-02-28T15:00:00Z', 'missing'], ['2026-02-28T14:59:59Z', 'missing'],
]);

test('a new CRM modification date never refreshes an old or undated declaration', function (?string $confirmedAt) {
    $crm = new OrganicProfileCrmFake;
    $crm->duplicates['LEAD'] = ['900'];
    $record = ['ID' => '900', 'CONTACT_ID' => '800', 'PHONE' => [['VALUE' => '5493510000000']],
        'UF_CRM_1693840106704' => '20301234563', 'DATE_MODIFY' => now()->toIso8601String(),
        'UF_CRM_WA_FLOW' => 'whatsapp_intake', 'UF_CRM_WA_PROVINCE' => 'cordoba',
        'UF_CRM_WA_SEGMENT' => 'cordoba_empleado_publico', 'UF_CRM_WA_BANCO' => 'bancor'];
    if ($confirmedAt !== null) {
        $record['UF_CRM_WA_TIMESTAMP'] = $confirmedAt;
    }
    $crm->records['lead'] = [$record];
    expect((new EdnaOrganicProfile($crm))->resolve(organicProfileMenu(), organicProfileProof())['status'])->toBe('missing');
    $select = collect($crm->calls)->first(fn ($call) => $call[0] === 'crm.lead.list')[1]['select'];
    expect($select)->not->toContain('DATE_MODIFY');
})->with([null, '2025-12-01T15:00:00Z']);

test('one shared phone with two saved CUIL identities is ambiguous unless native CRM proves one identity', function (bool $nativeKnown) {
    organicSaveProfile();
    organicSaveProfile(['cuil' => '20987654326'], now()->subDays(2)->toIso8601String());
    $crm = new OrganicProfileCrmFake;
    if ($nativeKnown) {
        $crm->lead['UF_CRM_1693840106704'] = '20301234563';
    }
    $result = (new EdnaOrganicProfile($crm))->resolve(organicProfileMenu(), organicProfileProof());
    expect($result['status'])->toBe($nativeKnown ? 'reusable' : 'ambiguous');
    if ($nativeKnown) {
        expect($result['answer']['cuil'])->toBe('20301234563');
    } else {
        expect($result['reason'])->toBe('profile_phone_has_multiple_identities')->and($result)->not->toHaveKey('answer');
    }
})->with([false, true]);

test('an attached contact cannot contradict the identity on the native lead', function () {
    organicSaveProfile();
    $crm = new OrganicProfileCrmFake;
    $crm->lead += ['UF_CRM_1693840106704' => '20301234563'];
    $crm->lead['CONTACT_ID'] = '800';
    $crm->duplicates['CONTACT'] = ['800'];
    $crm->records['contact'] = [['ID' => '800', 'PHONE' => [['VALUE' => '5493510000000']], 'UF_CRM_65B7E48033FCD' => '20987654326']];
    expect((new EdnaOrganicProfile($crm))->resolve(organicProfileMenu(), organicProfileProof()))
        ->toMatchArray(['status' => 'ambiguous', 'reason' => 'profile_native_contact_conflict']);
});

test('incomplete assistance and stale records never masquerade as a complete recent profile', function (string $change) {
    $crm = new OrganicProfileCrmFake;
    $crm->duplicates['LEAD'] = ['900'];
    $record = ['ID' => '900', 'PHONE' => [['VALUE' => '5493510000000']], 'UF_CRM_1693840106704' => '20301234563',
        'UF_CRM_WA_FLOW' => 'whatsapp_intake', 'UF_CRM_WA_TIMESTAMP' => now()->subMonth()->toIso8601String(),
        'UF_CRM_WA_PROVINCE' => 'cordoba', 'UF_CRM_WA_SEGMENT' => 'cordoba_empleado_publico', 'UF_CRM_WA_BANCO' => 'bancor'];
    match ($change) {
        'incomplete' => $record['UF_CRM_WA_BANCO'] = '',
        'assistance' => $record['UF_CRM_WA_FLOW'] = 'whatsapp_assistance',
        'stale' => $record['UF_CRM_WA_TIMESTAMP'] = now()->subMonthsNoOverflow(7)->toIso8601String(),
    };
    $crm->records['lead'] = [$record];
    expect((new EdnaOrganicProfile($crm))->resolve(organicProfileMenu(), organicProfileProof())['status'])->toBe('missing');
})->with(['incomplete', 'assistance', 'stale']);

test('profile retry cannot refresh the declared date or silently replace identity', function () {
    $profile = new EdnaOrganicProfile;
    $id = (string) Str::uuid();
    $date = now()->subMonthsNoOverflow(7);
    expect($profile->record('web_form', $id, '5493510000000', organicSavedAnswer(), $date))->toBeTrue()
        ->and($profile->record('web_form', $id, '5493510000000', organicSavedAnswer(['cuil' => '20987654326']), now()))->toBeFalse();
    $row = DB::table('edna_customer_profiles')->first();
    expect(CarbonImmutable::parse($row->confirmed_at)->equalTo($date))->toBeTrue()
        ->and($row->identity_hash)->toBe((new WebFormReceipt)->identityHash('20301234563'))
        ->and($row->answer)->not->toContain('20301234563', 'client@example.test');
});

test('a profile source must provide an explicit valid declaration timestamp', function (mixed $date) {
    expect((new EdnaOrganicProfile)->record('web_form', (string) Str::uuid(), '5493510000000', organicSavedAnswer(), $date))->toBeFalse()
        ->and(DB::table('edna_customer_profiles')->count())->toBe(0);
})->with([null, '', 'definitely-not-a-date']);

test('unsupported source incomplete identity invalid phone and future declarations cannot enter the registry', function (string $change) {
    $source = 'web_form';
    $id = (string) Str::uuid();
    $phone = '5493510000000';
    $answer = organicSavedAnswer();
    $date = now()->subDay();
    match ($change) {
        'source' => $source = 'crm_modification',
        'source_id' => $id = '',
        'phone' => $phone = 'not-a-phone',
        'identity' => $answer['cuil'] = '20301234564',
        'incomplete' => $answer['banco_cordoba'] = '',
        'future' => $date = now()->addMinutes(6),
    };
    expect((new EdnaOrganicProfile)->record($source, $id, $phone, $answer, $date))->toBeFalse()
        ->and(DB::table('edna_customer_profiles')->count())->toBe(0);
})->with(['source', 'source_id', 'phone', 'identity', 'incomplete', 'future']);

test('website input becomes complete V3 data only through supported unambiguous answers', function () {
    $profile = new EdnaOrganicProfile;
    $base = ['provincia' => 'Córdoba', 'situacion_laboral' => 'Empleado público provincial',
        'banco' => 'Banco de la Provincia de Córdoba S.A.', 'cuil' => '20-30123456-3', 'email' => 'Client@Example.test'];
    expect($profile->websiteAnswer($base))->toMatchArray(['provincia' => 'cordoba', 'situacion_cordoba' => 'empleado_publico',
        'banco_cordoba' => 'bancor', 'cuil' => '20301234563', 'email' => 'client@example.test'])
        ->and($profile->websiteAnswer(array_replace($base, ['situacion_laboral' => 'Pensionado'])))->toBeNull()
        ->and($profile->websiteAnswer(array_replace($base, ['banco' => 'Unknown bank'])))->toBeNull()
        ->and($profile->completeAnswer(organicSavedAnswer(['cuil' => '20301234564'])))->toBeNull();
});

test('bounded registry search never chooses a profile from a truncated candidate set', function () {
    for ($i = 0; $i < 102; $i++) {
        organicSaveProfile([], now()->subDays(2)->addSeconds($i)->toIso8601String());
    }
    $result = (new EdnaOrganicProfile(new OrganicProfileCrmFake))->resolve(organicProfileMenu(), organicProfileProof());
    expect($result['status'])->not->toBe('reusable')->and($result)->not->toHaveKey('answer');
});

function organicHistoricalWebLead(array $changes = []): array
{
    return array_replace(['ID' => '900', 'CONTACT_ID' => '800', 'PHONE' => [['VALUE' => '5493510000000']],
        'EMAIL' => [['VALUE' => 'client@example.test']], 'UF_CRM_1693840106704' => '20301234563',
        'UF_CRM_64E65D2B2136C' => '101', 'UF_CRM_1714071903' => '201', 'UF_CRM_LEAD_1711458190312' => '301',
        'DATE_MODIFY' => now()->toIso8601String(), 'DATE_CREATE' => now()->subYears(2)->toIso8601String()], $changes);
}

function organicHistoricalWebCrm(array $record = []): OrganicProfileCrmFake
{
    $crm = new OrganicProfileCrmFake;
    $lead = organicHistoricalWebLead($record);
    $crm->duplicates['LEAD'] = [(string) $lead['ID']];
    $crm->records['lead'] = [$lead];
    $crm->getRecords[(string) $lead['ID']] = $lead;

    return $crm;
}

function organicHistoricalWebReceipt(array $changes = []): object
{
    $id = (string) Str::uuid();
    DB::table('web_form_receipts')->insert(array_replace(['id' => $id, 'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'),
        'identity_hash' => (new WebFormReceipt)->identityHash('20301234563'), 'state' => 'synced', 'source' => 'web_server',
        'lead_id' => '900', 'contact_id' => '800', 'received_at' => now()->subDays(20), 'persisted_at' => now()->subDays(20),
        'expires_at' => now()->subDays(19), 'created_at' => now()->subDays(20), 'updated_at' => now()], $changes));

    return DB::table('web_form_receipts')->where('id', $changes['id'] ?? $id)->first();
}

test('a historical synced web receipt reuses complete CRM declarations without WA fields or a new registry row', function () {
    $receipt = organicHistoricalWebReceipt();
    $crm = organicHistoricalWebCrm();
    $service = new EdnaOrganicProfile($crm);
    $result = $service->resolve(organicProfileMenu(), organicProfileProof());
    expect($result['status'])->toBe('reusable')
        ->and($result['answer'])->toMatchArray(['provincia' => 'cordoba', 'situacion_cordoba' => 'empleado_publico',
            'banco_cordoba' => 'bancor', 'cuil' => '20301234563'])
        ->and($result['provenance'])->toMatchArray(['source_kind' => 'web_form', 'source_id' => $receipt->id,
            'confirmed_at' => CarbonImmutable::parse($receipt->received_at)->utc()->toIso8601String(), 'web_lead_id' => '900'])
        ->and(DB::table('edna_customer_profiles')->count())->toBe(0)
        ->and($service->stillCurrent(organicProfileMenu(), $result['answer'], $result['provenance'], ['records' => []]))->toBeTrue();
    expect(collect($crm->calls)->where(fn ($call) => $call[0] === 'crm.lead.fields'))->toHaveCount(2);
    Http::assertNothingSent();
});

test('historical web freshness never comes from CRM dates without a valid matching recent receipt', function (string $change) {
    $crm = organicHistoricalWebCrm();
    if ($change !== 'missing') {
        organicHistoricalWebReceipt(match ($change) {
            'stale' => ['received_at' => now()->subMonthsNoOverflow(7)],
            'pending' => ['state' => 'pending'],
            'phone' => ['phone_hash' => (new AttributionJourney)->phoneHash('5493519999999')],
            'identity' => ['identity_hash' => (new WebFormReceipt)->identityHash('20987654326')],
            'lead' => ['lead_id' => '901'],
            'contact' => ['contact_id' => '801'],
            'source' => ['source' => 'client'],
        });
    }
    $result = (new EdnaOrganicProfile($crm))->resolve(organicProfileMenu(), organicProfileProof());
    expect($result['status'])->toBe('missing')->and($result)->not->toHaveKey('answer');
})->with(['missing', 'stale', 'pending', 'phone', 'identity', 'lead', 'contact', 'source']);

test('historical enum values must have one exact schema ID and cannot be guessed from IDs or labels', function (string $change) {
    organicHistoricalWebReceipt();
    $crm = organicHistoricalWebCrm();
    match ($change) {
        'unknown' => $crm->records['lead'][0]['UF_CRM_64E65D2B2136C'] = '999',
        'label' => $crm->records['lead'][0]['UF_CRM_64E65D2B2136C'] = 'Córdoba',
        'multiple' => $crm->records['lead'][0]['UF_CRM_1714071903'] = ['201'],
        'ambiguous' => $crm->schema['UF_CRM_1714071903']['items'][] = ['ID' => '201', 'VALUE' => 'Pensionado'],
        'pension' => $crm->schema['UF_CRM_1714071903']['items'][0]['VALUE'] = 'Pensionado',
        'incomplete' => $crm->schema['UF_CRM_LEAD_1711458190312']['items'] = [],
    };
    $result = (new EdnaOrganicProfile($crm))->resolve(organicProfileMenu(), organicProfileProof());
    expect($result['status'])->not->toBe('reusable')->and($result)->not->toHaveKey('answer');
})->with(['unknown', 'label', 'multiple', 'ambiguous', 'pension', 'incomplete']);

test('historical metadata is fetched once per lookup for all matched leads and controlled fields are explicitly selected', function () {
    organicHistoricalWebReceipt();
    organicHistoricalWebReceipt(['lead_id' => '901', 'received_at' => now()->subDays(21)]);
    $crm = organicHistoricalWebCrm();
    $crm->duplicates['LEAD'][] = '901';
    $crm->records['lead'][] = organicHistoricalWebLead(['ID' => '901']);
    $result = (new EdnaOrganicProfile($crm))->resolve(organicProfileMenu(), organicProfileProof());
    expect($result['status'])->toBe('reusable')
        ->and(collect($crm->calls)->filter(fn ($call) => $call[0] === 'crm.lead.fields'))->toHaveCount(1);
    $select = collect($crm->calls)->first(fn ($call) => $call[0] === 'crm.lead.list')[1]['select'];
    expect($select)->toContain('UF_CRM_64E65D2B2136C', 'UF_CRM_1714071903', 'UF_CRM_LEAD_1711458190312')
        ->not->toContain('DATE_MODIFY', 'DATE_CREATE');
});

test('historical web receipts for two CUILs sharing one phone require a new identity confirmation', function () {
    organicHistoricalWebReceipt();
    organicHistoricalWebReceipt(['lead_id' => '901', 'contact_id' => '801',
        'identity_hash' => (new WebFormReceipt)->identityHash('20987654326')]);
    $crm = organicHistoricalWebCrm();
    $crm->duplicates['LEAD'][] = '901';
    $crm->records['lead'][] = organicHistoricalWebLead(['ID' => '901', 'CONTACT_ID' => '801', 'UF_CRM_1693840106704' => '20987654326']);
    $result = (new EdnaOrganicProfile($crm))->resolve(organicProfileMenu(), organicProfileProof());
    expect($result)->toMatchArray(['status' => 'ambiguous', 'reason' => 'profile_phone_has_multiple_identities'])
        ->not->toHaveKey('answer');
});

test('historical receipt pagination cannot silently choose the most convenient hundred declarations', function () {
    for ($i = 0; $i < 101; $i++) {
        organicHistoricalWebReceipt();
    }
    $result = (new EdnaOrganicProfile(organicHistoricalWebCrm()))->resolve(organicProfileMenu(), organicProfileProof());
    expect($result['status'])->not->toBe('reusable')->and($result)->not->toHaveKey('answer');
});

test('captured historical web data is revalidated against receipt CRM identity and current enum labels', function (string $change) {
    $receipt = organicHistoricalWebReceipt();
    $crm = organicHistoricalWebCrm();
    $service = new EdnaOrganicProfile($crm);
    $result = $service->resolve(organicProfileMenu(), organicProfileProof());
    expect($result['status'])->toBe('reusable');
    match ($change) {
        'cuil' => $crm->getRecords['900']['UF_CRM_1693840106704'] = '20987654326',
        'phone' => $crm->getRecords['900']['PHONE'] = [['VALUE' => '5493519999999']],
        'contact' => $crm->getRecords['900']['CONTACT_ID'] = '801',
        'label' => $crm->schema['UF_CRM_64E65D2B2136C']['items'][0]['VALUE'] = 'Cordoba',
        'answer' => $crm->schema['UF_CRM_1714071903']['items'][0]['VALUE'] = 'Pensionado',
        'state' => DB::table('web_form_receipts')->where('id', $receipt->id)->update(['state' => 'uncertain']),
        'date' => DB::table('web_form_receipts')->where('id', $receipt->id)->update(['received_at' => now()->subDay()]),
        'receipt_identity' => DB::table('web_form_receipts')->where('id', $receipt->id)->update(['identity_hash' => (new WebFormReceipt)->identityHash('20987654326')]),
        'receipt_lead' => DB::table('web_form_receipts')->where('id', $receipt->id)->update(['lead_id' => '901']),
        'newer' => organicHistoricalWebReceipt(['received_at' => now()->subDay()]),
    };
    expect($service->stillCurrent(organicProfileMenu(), $result['answer'], $result['provenance'], ['records' => []]))->toBeFalse();
})->with(['cuil', 'phone', 'contact', 'label', 'answer', 'state', 'date', 'receipt_identity', 'receipt_lead', 'newer']);
