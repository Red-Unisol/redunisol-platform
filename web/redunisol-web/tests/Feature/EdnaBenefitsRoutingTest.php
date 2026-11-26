<?php

use App\Jobs\RouteEdnaBenefitsChat;
use App\Services\EdnaBenefitsCase;
use App\Services\EdnaBenefitsRouting;
use App\Services\EdnaBitrix;
use App\Services\EdnaCampaignTemplate;
use App\Services\SalesChatRoutingPolicy;
use App\Services\WebFormChatGuard;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-18T15:00:00Z'));
    config()->set(['edna.enabled' => true, 'edna.intake_crm_enabled' => true, 'edna.subject_id' => '2423',
        'edna.bitrix_url' => 'https://redunisol.bitrix24.es/rest/71283/testingToken/',
        'app.key' => 'base64:'.base64_encode(str_repeat('b', 32))]);
    DB::table('edna_intake_cutovers')->insert(['name' => EdnaBenefitsRouting::NAME, 'entry_id_after' => 0, 'starts_at' => now()->subMinute()]);
    Queue::fake();
    Http::preventStrayRequests();
});

class BenefitsRouteCrmFake extends EdnaBitrix
{
    public array $calls = [];

    public int $posts = 0;

    public int $expectedTarget = 117941;

    public string $mode = 'ack';

    public bool $attended = false;

    public bool $userActive = true;

    public bool $incomplete = false;

    public string $crmTransferChange = 'N';

    public array $userOverrides = [];

    public array $transfers = [];

    public ?Closure $beforeCall = null;

    public array $dialog = ['id' => 601, 'owner' => 74827, 'entity_type' => 'LINES',
        'entity_id' => 'whatsappbyedna|1|5493510000000@2423|999',
        'entity_data_1' => 'Y|DEAL|900|N|N|501|1795010400|0|0|0',
        'entity_data_2' => 'LEAD|700|CONTACT|710|COMPANY|0|DEAL|900', 'text_field_enabled' => true];

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = [$method, $payload];
        if ($this->beforeCall) {
            ($this->beforeCall)($method, $payload);
        }
        if ($method === 'imopenlines.operator.transfer') {
            $this->posts++;
            expect($payload)->toBe(['CHAT_ID' => 601, 'USER_ID' => $this->expectedTarget]);
            if ($this->mode !== 'lost_without_apply') {
                $this->dialog['owner'] = $this->expectedTarget;
                $this->transfers[] = ['sessionId' => 501, 'date' => now()->toIso8601String(),
                    'fromOperatorId' => 71283, 'toOperatorId' => $this->expectedTarget, 'fromConfigId' => 1,
                    'toConfigId' => null, 'reason' => 'manual', 'mode' => 'MANUAL', 'type' => 'USER', 'initiatorId' => 71283];
            }
            if (in_array($this->mode, ['lost_without_apply', 'lost_after_apply'], true)) {
                throw new RuntimeException('Synthetic transport failure.');
            }

            return $this->mode === 'ack';
        }

        return match ($method) {
            'user.get' => [array_replace(['ID' => (string) $payload['ID'], 'ACTIVE' => $this->userActive, 'UF_DEPARTMENT' => [1]], $this->userOverrides)],
            'imopenlines.config.get' => ['ID' => '1', 'CRM_TRANSFER_CHANGE' => $this->crmTransferChange],
            'imopenlines.dialog.get' => $this->dialog,
            'imopenlines.v2.Session.Stat.get' => ['sessions' => [['sessionId' => 501, 'transfersCount' => count($this->transfers)]]],
            'imopenlines.v2.Session.Transfer.list' => ['hasNextPage' => $this->incomplete, 'transfers' => $this->transfers],
            default => throw new RuntimeException('Benefits routing must never mutate CRM or send customer content: '.$method),
        };
    }
}

class BenefitsRouteCaseFake extends EdnaBenefitsCase
{
    public int $calls = 0;

    public int $unifiedCalls = 0;

    public string $status = 'benefits';

    public string $reason = 'native_benefits_case';

    public ?Closure $beforeResolve = null;

    public array $case = ['deal_id' => '900', 'category_id' => '15', 'contact_id' => '710', 'lead_id' => '700',
        'responsible_id' => '117941', 'stage' => 'C15:NEW', 'closed' => 'N'];

    public function __construct(public BenefitsRouteCrmFake $fake) {}

    public function resolveUnified(array $proof): array
    {
        $this->unifiedCalls++;

        return $this->resolve($proof);
    }

    public function resolve(array $proof): array
    {
        $this->calls++;
        if ($this->beforeResolve) {
            ($this->beforeResolve)($this->calls);
        }
        $parts = explode('|', $this->fake->dialog['entity_data_1']);

        return ['status' => $this->status, 'reason' => $this->reason, 'case' => $this->status === 'benefits' ? $this->case : null, 'chat_id' => '601', 'session_id' => '501',
            'snapshot' => ['dialog_tuple' => ['chat_id' => '601', 'session_id' => '501',
                'source_hash' => hash_hmac('sha256', 'organic-source:'.$this->fake->dialog['entity_id'], config('app.key')),
                'owner' => (string) $this->fake->dialog['owner'], 'session_epoch' => $parts[6],
                'primary_entity' => 'deal', 'primary_id' => '900', 'bindings' => ['contact' => '710', 'deal' => '900', 'lead' => '700']],
                'records' => [['id' => '710', 'owner' => '90231']]]]; // Contact's commercial owner is deliberately different.
    }

    public function compatible(array $before, array $after, bool $afterTransfer = false): bool
    {
        if ($before['case'] !== $after['case'] || $before['snapshot']['records'] !== $after['snapshot']['records']) {
            return false;
        }
        if ($afterTransfer) {
            $before['snapshot']['dialog_tuple']['owner'] = $before['case']['responsible_id'];
        }

        return $before['snapshot'] === $after['snapshot'];
    }
}

class BenefitsRouteGuardFake extends WebFormChatGuard
{
    public int $calls = 0;

    public ?Closure $beforeInspect = null;

    public function __construct(public BenefitsRouteCrmFake $fake) {}

    public function inspect(array $proof, string $sellerId): array
    {
        $this->calls++;
        if ($this->beforeInspect) {
            ($this->beforeInspect)($this->calls);
        }
        $owner = $this->fake->dialog['owner'];
        $state = $owner === (int) $sellerId ? 'already_assigned'
            : ($this->fake->attended || ! in_array($owner, [0, 57, 74827], true) ? 'preserved' : 'ready');

        return ['status' => $state, 'reason' => $state === 'preserved' ? 'operator_attention_preserved' : 'unattended_sales_session',
            'owner_id' => $owner, 'session_id' => 501, 'dialog' => $this->fake->dialog];
    }
}

function benefitsRouteEvent(array $changes = []): object
{
    $mid = (string) (200001 + DB::table('edna_incoming_events')->count());
    $payload = array_replace_recursive(['id' => $mid, 'subjectId' => '2423', 'receivedAt' => now()->toIso8601String(),
        'subscriber' => ['identifier' => '5493510000000'], 'messageContent' => ['type' => 'BUTTON', 'text' => 'Consulta']], $changes);
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => $payload['subjectId'], 'message_id' => $payload['id'],
        'payload' => Crypt::encryptString(json_encode($payload)), 'status' => 'delivered', 'created_at' => now(), 'updated_at' => now()]);

    return DB::table('edna_incoming_events')->find($id);
}

function benefitsRouteProof(object $event): array
{
    return ['version' => 2, 'verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'entry_event_id' => $event->id, 'entry_message_id' => $event->message_id, 'chat_id' => '601', 'session_id' => '501',
        'message_id' => '701', 'activity_id' => '801', 'native_lead_id' => '700'];
}

function benefitsRouteFixture(bool $reserve = true): object
{
    $event = benefitsRouteEvent();
    $crm = new BenefitsRouteCrmFake;
    $cases = new BenefitsRouteCaseFake($crm);
    $guard = new BenefitsRouteGuardFake($crm);
    $service = new EdnaBenefitsRouting($crm, $cases, $guard);
    $f = (object) compact('event', 'crm', 'cases', 'guard', 'service');
    $f->proof = benefitsRouteProof($event);
    if ($reserve) {
        expect($service->check($event, $f->proof))->toBe(['state' => 'preserved', 'reason' => 'benefits_routing']);
    }

    return $f;
}

function benefitsRouteRow(object $f): object
{
    return DB::table('edna_benefit_chat_routes')->where('entry_event_id', $f->event->id)->first();
}

test('a fresh benefits handoff rechecks isolation and attention and reserves exactly one session transfer', function (string $scenario, string $expected) {
    $f = benefitsRouteFixture(false);
    app()->instance(EdnaBitrix::class, $f->crm);
    DB::table('edna_intake_cutovers')->insert(['name' => SalesChatRoutingPolicy::CUTOVER, 'starts_at' => now()->subMinute(),
        'entry_id_after' => $scenario === 'preexisting' ? $f->event->id : 0]);
    if ($scenario === 'queue as deal owner') {
        $f->cases->case['responsible_id'] = '74827';
    }
    $f->service->check($f->event, $f->proof);
    $configReads = 0;
    $f->crm->beforeCall = function ($method) use ($f, $scenario, &$configReads) {
        if ($method !== 'imopenlines.config.get' || ++$configReads !== 2) {
            return;
        }
        match ($scenario) {
            'propagation enabled during work' => $f->crm->crmTransferChange = 'Y',
            'operator takes chat during work' => $f->crm->attended = true,
            default => null,
        };
    };
    if ($scenario === 'other route already claimed') {
        expect(DB::transaction(fn () => app(SalesChatRoutingPolicy::class)->reserveHandoff($f->proof, 'reopening', 90233)))->toBeTrue();
    }
    $result = $f->service->process($f->event->id);
    expect($result['state'])->toBe($expected)
        ->and($f->crm->posts)->toBe($expected === 'routed' ? 1 : 0)
        ->and($f->cases->unifiedCalls > 0)->toBe($scenario !== 'preexisting');
    if ($expected === 'routed') {
        expect(benefitsRouteRow($f)->transfer_state)->toBe('confirmed');
        $f->service->process($f->event->id);
        expect($f->crm->posts)->toBe(1);
    } else {
        expect(benefitsRouteRow($f)->transfer_intent)->toBeNull();
    }
})->with([
    ['new intake', 'routed'], ['preexisting', 'routed'], ['queue as deal owner', 'waiting'],
    ['propagation enabled during work', 'waiting'], ['operator takes chat during work', 'preserved'],
    ['other route already claimed', 'preserved'],
]);

function benefitsCampaignReply(string $matcher, string $name, string $label, string $type = 'BUTTON', string $action = 'benefits'): array
{
    $event = benefitsRouteEvent(['replyOutMessageId' => '456', 'messageContent' => ['type' => $type, 'text' => $label, 'payload' => $label]]);
    $outbound = ['messageId' => '456', 'subjectId' => '2423', 'matcherId' => $matcher, 'matcherName' => $name,
        'sentOrReceivedAt' => now()->subMinute()->toISOString()];

    return [$event, benefitsRouteProof($event), ['action' => $action, 'outbound' => $outbound]];
}

function enableBenefitsCampaigns(): void
{
    DB::table('edna_intake_cutovers')->updateOrInsert(['name' => EdnaCampaignTemplate::CUTOVER],
        ['entry_id_after' => 0, 'starts_at' => now()->subMinute()]);
}

function walletReplyAt(string $label, CarbonImmutable $at, string $stage = 'verified', string $mid = '456', string $session = '501', string $phone = '5493510000000'): void
{
    $event = benefitsRouteEvent(['replyOutMessageId' => $mid, 'receivedAt' => $at->toISOString(), 'subscriber' => ['identifier' => $phone],
        'messageContent' => ['type' => 'BUTTON', 'text' => $label, 'payload' => $label]]);
    DB::table('edna_campaign_reply_inbox')->insert(['entry_event_id' => $event->id, 'subject_id' => '2423', 'outbound_message_id' => $mid]);
    if ($stage === 'inbox') {
        DB::table('edna_incoming_events')->where('id', $event->id)->update(['status' => 'pending']);
        return;
    }
    if ($stage === 'unrelated') {
        return;
    }
    $reply = ['entry_event_id' => $event->id, 'received_at' => $at->toISOString(), 'reply_out_message_id' => $mid];
    if ($stage === 'verified') {
        $reply += ['action' => $label === 'Ahora no' ? 'decline' : 'benefits',
            'native_proof' => array_replace(benefitsRouteProof($event), ['session_id' => $session]),
            'outbound' => ['subjectId' => '2423', 'messageId' => $mid, 'matcherId' => '62723', 'matcherName' => 'aviso_billetera_v3']];
    }
    DB::table('edna_organic_menus')->insert(['entry_event_id' => $event->id, 'request_id' => (string) \Illuminate\Support\Str::uuid(),
        'subject_id' => '2423', 'cascade_id' => '1', 'phone_hash' => (new \App\Services\AttributionJourney)->phoneHash($phone),
        'recipient' => Crypt::encryptString($phone), 'entry_received_at' => $at, 'expires_at' => $at->addDay(),
        'form_consent' => json_encode($reply, JSON_THROW_ON_ERROR)]);
}

test('the last reply to a wallet send governs a pending transfer at its final guard', function (string $scenario, string $expected) {
    enableBenefitsCampaigns();
    $f = benefitsRouteFixture(false);
    $args = benefitsCampaignReply('62723', 'aviso_billetera_v3', 'Quiero más info');
    $f->service->reserveCampaign(...$args);
    $at = CarbonImmutable::now();
    $f->guard->beforeInspect = function ($call) use ($scenario, $at) {
        if ($call !== 2) {
            return;
        }
        match ($scenario) {
            'pending inbox' => walletReplyAt('Ahora no', $at->addSecond(), 'inbox'),
            'pending provider' => walletReplyAt('Ahora no', $at->addSecond(), 'candidate'),
            'unrelated completed path' => walletReplyAt('Ahora no', $at->addSecond(), 'unrelated'),
            'different outbound' => walletReplyAt('Ahora no', $at->addSecond(), 'inbox', '457'),
            'different recipient' => walletReplyAt('Ahora no', $at->addSecond(), 'inbox', '456', '501', '5493510000001'),
            'different native session' => walletReplyAt('Ahora no', $at->addSecond(), 'verified', '456', '502'),
            'later callback carrying older refusal' => walletReplyAt('Ahora no', $at->subSecond()),
            'equal timestamp refusal' => walletReplyAt('Ahora no', $at),
            'verified refusal' => walletReplyAt('Ahora no', $at->addSecond()),
            'yes received after no' => [walletReplyAt('Quiero más info', $at->addSeconds(2)), walletReplyAt('Ahora no', $at->addSecond())],
        };
    };
    expect($f->service->process($args[0]->id)['state'])->toBe($expected)->and($f->crm->posts)->toBe($expected === 'routed' ? 1 : 0);
    if ($expected !== 'routed') {
        expect(DB::table('edna_benefit_chat_routes')->sole()->transfer_intent)->toBeNull();
    }
})->with([
    ['pending inbox', 'waiting'], ['pending provider', 'waiting'], ['unrelated completed path', 'routed'], ['verified refusal', 'preserved'],
    ['equal timestamp refusal', 'preserved'], ['different outbound', 'routed'], ['different recipient', 'routed'],
    ['different native session', 'routed'], ['later callback carrying older refusal', 'routed'], ['yes received after no', 'routed'],
]);

test('a refusal does not hold the session hostage for separate requests, and a later affirmative can resume', function (string $next) {
    enableBenefitsCampaigns();
    $f = benefitsRouteFixture(false);
    $first = benefitsCampaignReply('62723', 'aviso_billetera_v3', 'Quiero más info');
    $f->service->reserveCampaign(...$first);
    walletReplyAt('Ahora no', CarbonImmutable::now()->addSecond());
    expect($f->service->process($first[0]->id)['reason'])->toBe('benefits_campaign_declined')->and($f->crm->posts)->toBe(0);
    $this->travel(3)->seconds();
    if ($next === 'positive again') {
        $args = benefitsCampaignReply('62723', 'aviso_billetera_v3', 'Quiero más info');
        $f->service->reserveCampaign(...$args);
    } elseif ($next === 'unsubscribe') {
        $args = benefitsCampaignReply('63271', 'aviso_soysocio_v5', 'Darse de baja', 'BUTTON', 'unsubscribe');
        $f->service->reserveCampaign(...$args);
        expect(DB::table('edna_campaign_unsubscribe_requests')->count())->toBe(1);
    } else {
        $event = benefitsRouteEvent();
        if ($next === 'no native Benefits case') {
            $f->cases->status = 'not_applicable';
            expect($f->service->check($event, benefitsRouteProof($event)))->toBeNull()->and($f->crm->posts)->toBe(0);
            return;
        }
        expect($f->service->check($event, benefitsRouteProof($event))['reason'])->toBe('benefits_routing');
    }
    expect($f->service->process($first[0]->id)['state'])->toBe('routed')->and($f->crm->posts)->toBe(1);
})->with(['positive again', 'unsubscribe', 'separate native Benefits case', 'no native Benefits case']);

test('a new verified wallet reply follows the currently assigned Benefits owner', function (string $id, string $name, string $label, string $type) {
    enableBenefitsCampaigns();
    $f = benefitsRouteFixture(false);
    $f->crm->expectedTarget = 90233;
    $f->cases->case['responsible_id'] = '90233';
    $args = benefitsCampaignReply($id, $name, $label, $type);
    expect($f->service->reserveCampaign(...$args)['reason'])->toBe('benefits_routing');
    $id = $args[0]->id;
    expect($f->service->process($id))->toBe(['state' => 'routed', 'reason' => 'benefits_transfer_confirmed'])
        ->and($f->crm->posts)->toBe(1)->and($f->service->process($id)['state'])->toBe('not_claimed');
    $row = DB::table('edna_benefit_chat_routes')->sole();
    expect((int) $row->deal_id)->toBe(900)->and((int) $row->target_id)->toBe(90233)
        ->and(json_decode($row->campaign_reply, true)['action'])->toBe('benefits')->and($row->transfer_state)->toBe('confirmed');
})->with([
    ['62129', 'primercontacto_billetera', 'Sí, quiero activarla', 'BUTTON'],
    ['62718', 'aviso_billetera_v2', 'Si, quiero activarla', 'BUTTON'],
    ['62723', 'aviso_billetera_v3', 'Quiero más info', 'BUTTON'],
    ['62742', 'seguimiento_billetera_octubre', 'Si, quiero mi regalo', 'BUTTON'],
    ['63042', 'aviso_billetera_v4link', 'Quiero más info', 'BUTTON'],
    ['63507', 'aviso_billetera_v5link', 'Sí, quiero activarla', 'BUTTON'],
    ['63508', 'aviso_billetera_v6link', 'Quiero más info', 'BUTTON'],
    ['63510', 'aviso_soysocio_v6final', 'Más info', 'BUTTON'],
    ['62826', 'billetera_datos', 'Estos son los datos solicitados', 'TEXT'],
]);

test('Victoria receives a verified campaign only when a current native read rules out an active Benefits case', function (string $scenario) {
    enableBenefitsCampaigns();
    $f = benefitsRouteFixture(false);
    $args = benefitsCampaignReply('62723', 'aviso_billetera_v3', 'Quiero más info');
    $f->service->reserveCampaign(...$args);
    $f->cases->status = $scenario === 'api outage' ? 'review' : 'not_applicable';
    $f->cases->reason = $scenario === 'api outage' ? 'native_benefits_case_unverified' : 'native_case_other_category';
    if ($scenario === 'human takes at final check') {
        $f->guard->beforeInspect = function ($call) use ($f) { $f->crm->attended = $call === 2; };
    }
    if ($scenario === 'deal appears') {
        $f->cases->beforeResolve = function ($call) use ($f) {
            if ($call === 2) {
                $f->cases->status = 'benefits';
            }
        };
    }
    $result = $f->service->process($args[0]->id);
    expect($result['state'])->toBe(match ($scenario) {
        'deal appears', 'api outage' => 'waiting', 'no active Benefits deal' => 'routed', default => 'preserved',
    })->and($f->crm->posts)->toBe($scenario === 'no active Benefits deal' ? 1 : 0);
    if ($scenario === 'deal appears') {
        $f->crm->expectedTarget = 90233;
        $f->cases->case['responsible_id'] = '90233';
        $this->travelTo(CarbonImmutable::parse(DB::table('edna_benefit_chat_routes')->value('available_at'))->addSecond());
        expect($f->service->process($args[0]->id)['state'])->toBe('routed')->and($f->crm->posts)->toBe(1);
    }
})->with(['no active Benefits deal', 'api outage', 'human takes at final check', 'deal appears']);

test('every explicit unsubscribe survives repeated callbacks or another route in this session', function () {
    enableBenefitsCampaigns();
    $f = benefitsRouteFixture(false);
    $first = benefitsCampaignReply('62718', 'aviso_billetera_v2', 'Quiero más información');
    $f->service->reserveCampaign(...$first);
    $f->service->process($first[0]->id);
    foreach (range(1, 2) as $index) {
        $args = benefitsCampaignReply('63271', 'aviso_soysocio_v5', 'Darse de baja', 'BUTTON', 'unsubscribe');
        $args[1]['message_id'] = (string) (701 + $index);
        $f->service->reserveCampaign(...$args);
        $f->service->reserveCampaign(...$args);
    }
    expect(DB::table('edna_campaign_unsubscribe_requests')->count())->toBe(2)
        ->and(DB::table('edna_campaign_unsubscribe_requests')->where('route_entry_event_id', $first[0]->id)->count())->toBe(2)
        ->and(DB::table('edna_benefit_chat_routes')->count())->toBe(1)->and($f->crm->posts)->toBe(1);
});

test('a new unsubscribe is registered and handed to Benefits without acknowledging cancellation', function (bool $taken) {
    enableBenefitsCampaigns();
    $f = benefitsRouteFixture(false);
    $f->crm->attended = $taken;
    $args = benefitsCampaignReply('63271', 'aviso_soysocio_v5', 'Darse de baja', 'BUTTON', 'unsubscribe');
    $f->service->reserveCampaign(...$args);
    expect(DB::table('edna_campaign_unsubscribe_requests')->sole()->requested_at)->not->toBeNull()
        ->and($f->service->process($args[0]->id)['state'])->toBe($taken ? 'preserved' : 'routed')
        ->and($f->crm->posts)->toBe($taken ? 0 : 1);
})->with([true, false]);

test('stale or mismatched campaign evidence cannot reserve a handoff or an unsubscribe', function (string $change) {
    enableBenefitsCampaigns();
    $f = benefitsRouteFixture(false);
    $args = benefitsCampaignReply('63271', 'aviso_soysocio_v5', 'Darse de baja', 'BUTTON', 'unsubscribe');
    match ($change) {
        'old' => DB::table('edna_intake_cutovers')->where('name', EdnaCampaignTemplate::CUTOVER)->update(['entry_id_after' => $args[0]->id]),
        'outbound' => $args[2]['outbound']['messageId'] = '657',
        'subject' => $args[2]['outbound']['subjectId'] = '12',
        'matcher' => $args[2]['outbound']['matcherName'] = 'aviso_billetera_v3',
        'decision' => $args[2]['action'] = 'benefits',
        'proof' => $args[1]['entry_message_id'] = '14',
    };
    expect($f->service->reserveCampaign(...$args)['state'])->toBe('review')
        ->and(DB::table('edna_campaign_unsubscribe_requests')->count())->toBe(0)
        ->and(DB::table('edna_benefit_chat_routes')->count())->toBe(0)
        ->and($f->crm->posts)->toBe(0);
})->with(['old', 'outbound', 'subject', 'matcher', 'decision', 'proof']);

test('only fresh authenticated callbacks can enter benefits routing', function (string $change) {
    $f = benefitsRouteFixture(false);
    $event = $f->event;
    $payload = json_decode(Crypt::decryptString($event->payload), true);
    match ($change) {
        'old id' => DB::table('edna_intake_cutovers')->update(['entry_id_after' => $event->id]),
        'old timestamp' => $payload['receivedAt'] = now()->subHour()->toIso8601String(),
        'eight hours' => $payload['receivedAt'] = now()->subHours(8)->toIso8601String(),
        'future' => $payload['receivedAt'] = now()->addMinutes(6)->toIso8601String(),
        'FLOW' => $payload['messageContent']['type'] = 'FLOW',
        'test' => $payload['messageContent']['text'] = '(ref: PRUEBAFORM)',
        'mid' => $payload['id'] = '999999',
        'subject' => $payload['subjectId'] = '9999',
        'invalid date' => $payload['receivedAt'] = 'not-a-date',
    };
    $event->payload = Crypt::encryptString(json_encode($payload));
    expect($f->service->eligibleEntry($event))->toBeFalse()->and($f->service->check($event, $f->proof))->toBeNull()
        ->and($f->cases->calls)->toBe(0)->and(DB::table('edna_benefit_chat_routes')->count())->toBe(0);
})->with(['old id', 'old timestamp', 'eight hours', 'future', 'FLOW', 'test', 'mid', 'subject', 'invalid date']);

test('a fresh button may reference an old message while its exact new callback is routed', function () {
    $f = benefitsRouteFixture(false);
    expect($f->service->eligibleEntry($f->event))->toBeTrue()
        ->and($f->service->check($f->event, $f->proof)['reason'])->toBe('benefits_routing')
        ->and(DB::table('jobs')->count())->toBe(1);
    Queue::assertPushed(RouteEdnaBenefitsChat::class, fn ($job) => $job->entryEventId === $f->event->id);
});

test('a verified route transfers once to the Benefits deal owner and requires real native evidence', function (int $owner) {
    $f = benefitsRouteFixture();
    $f->crm->dialog['owner'] = $owner;
    expect($f->service->process($f->event->id))->toBe(['state' => 'routed', 'reason' => 'benefits_transfer_confirmed'])
        ->and($f->crm->posts)->toBe(1)->and($f->guard->calls)->toBe(2)
        ->and(benefitsRouteRow($f)->transfer_state)->toBe('confirmed')->and((bool) benefitsRouteRow($f)->transfer_acknowledged)->toBeTrue();
    $intent = json_decode(benefitsRouteRow($f)->transfer_intent, true);
    $native = json_decode(benefitsRouteRow($f)->native_transfer, true);
    expect($intent)->toMatchArray(['owner_before' => $owner, 'actor_id' => 71283, 'target_id' => '117941'])
        ->and($native)->toMatchArray(['from_operator_id' => 71283, 'target_id' => 117941, 'session_id' => 501])
        ->and($f->service->process($f->event->id)['state'])->toBe('not_claimed')->and($f->crm->posts)->toBe(1);
    expect(json_encode($native))->not->toContain('5493510000000', 'testingToken');
    foreach ($f->crm->calls as [$method]) {
        expect($method)->not->toContain('.update', '.add', 'message', 'answer', 'finish');
    }
})->with([0, 57, 74827]);

test('current ownership by Victoria is only observed and never becomes a made up transfer', function () {
    $f = benefitsRouteFixture();
    $f->crm->dialog['owner'] = 117941;
    expect($f->service->process($f->event->id))->toMatchArray(['state' => 'routed', 'reason' => 'benefits_owner_already_observed'])
        ->and($f->crm->posts)->toBe(0)->and(benefitsRouteRow($f)->transfer_state)->toBe('not_needed')
        ->and(benefitsRouteRow($f)->transfer_intent)->toBeNull()->and((bool) benefitsRouteRow($f)->transfer_acknowledged)->toBeFalse();
    expect($f->service->check($f->event, $f->proof))->not->toBeNull();
});

test('taking or answering the chat during final case reads prevents any handoff', function () {
    $f = benefitsRouteFixture();
    $f->cases->beforeResolve = function ($count) use ($f) {
        if ($count === 3) {
            $f->crm->attended = true;
        }
    };
    expect($f->service->process($f->event->id)['state'])->toBe('preserved')->and($f->crm->posts)->toBe(0);
});

test('manual owners and late identity changes stay untouched', function (string $change) {
    $f = benefitsRouteFixture();
    if ($change === 'manual owner') {
        $f->crm->dialog['owner'] = 29;
    } else {
        $f->guard->beforeInspect = function ($count) use ($f) {
            if ($count === 2) {
                $f->crm->dialog['entity_data_2'] = 'CONTACT|711|DEAL|900';
            }
        };
    }
    expect($f->service->process($f->event->id)['state'])->toBe('preserved')->and($f->crm->posts)->toBe(0);
})->with(['manual owner', 'late identity']);

test('a superseded lease or occupied shared chat lock cannot issue a POST', function (string $change) {
    $f = benefitsRouteFixture();
    $lock = null;
    if ($change === 'lock') {
        $lock = Cache::lock('web-form-chat:601', 120);
        $lock->get();
    } else {
        $f->guard->beforeInspect = function ($count) {
            if ($count === 2) {
                DB::table('edna_benefit_chat_routes')->update(['lease_token' => 'another-worker']);
            }
        };
    }
    try {
        expect($f->service->process($f->event->id)['state'])->toBe($change === 'lock' ? 'waiting' : 'superseded')->and($f->crm->posts)->toBe(0);
    } finally {
        $lock?->release();
    }
})->with(['lock', 'lease']);

test('an uncertain POST is never repeated by a later callback in the same chat and session', function (string $mode, string $state) {
    $f = benefitsRouteFixture();
    $f->crm->mode = $mode;
    expect($f->service->process($f->event->id)['state'])->toBe($state)->and($f->crm->posts)->toBe(1);
    $deadline = benefitsRouteRow($f)->expires_at;
    $event = benefitsRouteEvent();
    expect($f->service->check($event, benefitsRouteProof($event)))->toBe(['state' => 'preserved', 'reason' => 'benefits_routing'])
        ->and(DB::table('edna_benefit_chat_routes')->count())->toBe(1)
        ->and(benefitsRouteRow($f)->expires_at)->toBe($deadline)
        ->and(benefitsRouteRow($f)->last_entry_event_id)->toBe($event->id);
    if ($state === 'unknown') {
        $this->travelTo(CarbonImmutable::parse(benefitsRouteRow($f)->available_at)->addSecond());
    }
    $f->service->process($f->event->id);
    expect($f->crm->posts)->toBe(1)->and($f->service->process($event->id)['state'])->toBe('not_claimed');
})->with([['lost_without_apply', 'unknown'], ['lost_after_apply', 'routed']]);

test('a native transfer without the matching ack and API actor never becomes confirmed', function (string $change) {
    $f = benefitsRouteFixture();
    if ($change === 'no ack') {
        $f->crm->mode = 'false';
    } else {
        $f->crm->beforeCall = function ($method) use ($f, $change) {
            if ($method === 'imopenlines.v2.Session.Transfer.list') {
                match ($change) {
                    'wrong actor' => $f->crm->transfers[0]['fromOperatorId'] = 74827,
                    'missing initiator' => $f->crm->transfers[0] = array_diff_key($f->crm->transfers[0], ['initiatorId' => true]),
                    'old date' => $f->crm->transfers[0]['date'] = now()->subHour()->toIso8601String(),
                    'wrong config' => $f->crm->transfers[0]['fromConfigId'] = 2,
                    'wrong target' => $f->crm->transfers[0]['toOperatorId'] = 29,
                };
            }
        };
    }
    expect($f->service->process($f->event->id)['state'])->toBe($change === 'no ack' ? 'routed' : 'unknown')
        ->and(benefitsRouteRow($f)->transfer_state)->toBe($change === 'no ack' ? 'observed' : 'unknown')
        ->and($f->crm->posts)->toBe(1);
})->with(['no ack', 'wrong actor', 'missing initiator', 'old date', 'wrong config', 'wrong target']);

test('transient classification retries can resolve not applicable without blocking the credit path', function () {
    $f = benefitsRouteFixture(false);
    $f->cases->status = 'review';
    $f->cases->reason = 'native_benefits_case_unverified';
    expect($f->service->check($f->event, $f->proof)['state'])->toBe('waiting');
    $f->cases->status = 'not_applicable';
    expect($f->service->check($f->event, $f->proof))->toBeNull()
        ->and(benefitsRouteRow($f)->state)->toBe('not_applicable')->and($f->crm->posts)->toBe(0);
    $f->cases->status = 'benefits';
    expect($f->service->check($f->event, $f->proof)['reason'])->toBe('benefits_routing');
});

test('a benefit that ceases to apply before the POST releases its prior classification snapshot', function () {
    $f = benefitsRouteFixture();
    $f->cases->status = 'not_applicable';
    expect($f->service->process($f->event->id)['state'])->toBe('not_applicable')
        ->and(benefitsRouteRow($f)->case_snapshot)->toBeNull()->and($f->crm->posts)->toBe(0)
        ->and($f->service->check($f->event, $f->proof))->toBeNull();
});

test('lost lease after an applied POST cannot lead any worker or callback to resend', function () {
    $f = benefitsRouteFixture();
    $f->crm->beforeCall = function ($method) {
        if ($method === 'imopenlines.operator.transfer') {
            DB::table('edna_benefit_chat_routes')->update(['lease_token' => 'replacement-worker']);
        }
    };
    expect($f->service->process($f->event->id)['state'])->toBe('superseded')
        ->and(benefitsRouteRow($f)->transfer_intent)->not->toBeNull()->and($f->crm->posts)->toBe(1);
    $new = benefitsRouteEvent();
    expect($f->service->check($new, benefitsRouteProof($new))['state'])->toBe('preserved');
    DB::table('edna_benefit_chat_routes')->update(['lease_token' => null, 'lease_until' => null, 'available_at' => now()]);
    $f->crm->beforeCall = null;
    expect($f->service->process($f->event->id)['state'])->toBe('routed')
        ->and(benefitsRouteRow($f)->transfer_state)->toBe('observed')->and($f->crm->posts)->toBe(1);
});

test('malformed or changed exact native proofs cannot create or retarget a route', function (string $change) {
    $f = benefitsRouteFixture();
    $proof = $f->proof;
    match ($change) {
        'mid' => $proof['entry_message_id'] = '999999',
        'activity' => $proof['activity_id'] = '0',
        'version' => $proof['version'] = 3,
        'session' => $proof['session_id'] = '502',
    };
    expect($f->service->check($f->event, $proof)['state'])->toBe('review')
        ->and(DB::table('edna_benefit_chat_routes')->count())->toBe(1)
        ->and(benefitsRouteRow($f)->session_id)->toBe(501)->and($f->crm->posts)->toBe(0);
})->with(['mid', 'activity', 'version', 'session']);

test('the destination must be an active employee with valid departments', function (array $overrides) {
    $f = benefitsRouteFixture();
    $f->crm->userOverrides = $overrides;
    expect($f->service->process($f->event->id))->toMatchArray(['state' => 'review', 'reason' => 'benefits_responsible_unavailable'])
        ->and($f->crm->posts)->toBe(0);
})->with([[['ACTIVE' => false]], [['USER_TYPE' => 'extranet']], [['UF_DEPARTMENT' => '1']],
    [['UF_DEPARTMENT' => []]], [['UF_DEPARTMENT' => [0]]], [['EXTERNAL_AUTH_ID' => 'crm']]]);

test('retries use exponential jitter without renewing the callback deadline', function () {
    $f = benefitsRouteFixture(false);
    $f->cases->status = 'review';
    $f->cases->reason = 'native_benefits_case_unverified';
    $f->service->check($f->event, $f->proof);
    $deadline = benefitsRouteRow($f)->expires_at;
    $start = now()->copy();
    expect($f->service->process($f->event->id)['state'])->toBe('waiting');
    $first = CarbonImmutable::parse(benefitsRouteRow($f)->available_at);
    expect($first->getTimestamp() - $start->getTimestamp())->toBeGreaterThanOrEqual(30)->toBeLessThanOrEqual(60);
    $this->travelTo($first->addSecond());
    $start = now()->copy();
    $f->service->process($f->event->id);
    expect(CarbonImmutable::parse(benefitsRouteRow($f)->available_at)->getTimestamp() - $start->getTimestamp())
        ->toBeGreaterThanOrEqual(60)->toBeLessThanOrEqual(120);
    expect(benefitsRouteRow($f)->expires_at)->toBe($deadline)->and($f->crm->posts)->toBe(0);
});

test('caller retries respect the classification backoff and revalidate not applicable when due', function () {
    $f = benefitsRouteFixture(false);
    $f->cases->status = 'review';
    $f->cases->reason = 'native_benefits_case_unverified';
    $f->service->check($f->event, $f->proof);
    $f->service->process($f->event->id);
    $calls = $f->cases->calls;
    $f->cases->status = 'not_applicable';
    expect($f->service->check($f->event, $f->proof)['state'])->toBe('waiting')->and($f->cases->calls)->toBe($calls);
    $this->travelTo(CarbonImmutable::parse(benefitsRouteRow($f)->available_at)->addSecond());
    expect($f->service->check($f->event, $f->proof))->toBeNull()->and($f->cases->calls)->toBe($calls + 1);
});

test('poll deduplicates physical jobs and prioritizes new callbacks ahead of reconciliation', function () {
    $f = benefitsRouteFixture();
    expect($f->service->poll())->toBe(0)->and(DB::table('jobs')->count())->toBe(1);
    DB::table('jobs')->delete();
    DB::table('edna_benefit_chat_routes')->where('entry_event_id', $f->event->id)->update(['attempts' => 3, 'state' => 'waiting']);
    $event = benefitsRouteEvent();
    $row = (array) benefitsRouteRow($f);
    $row['entry_event_id'] = $event->id;
    $row['last_entry_event_id'] = $event->id;
    $row['chat_id'] = 602;
    $row['session_id'] = 502;
    $row['attempts'] = 0;
    DB::table('edna_benefit_chat_routes')->insert($row);
    expect($f->service->poll(1))->toBe(1)->and(DB::table('jobs')->count())->toBe(1);
    $payload = json_decode(DB::table('jobs')->sole()->payload, true);
    expect(unserialize($payload['data']['command'])->entryEventId)->toBe($event->id);
});

test('the fixed original eight hour window expires without waking or replaying old callbacks', function () {
    $f = benefitsRouteFixture();
    $this->travel(8)->hours();
    expect($f->service->process($f->event->id)['state'])->toBe('expired')->and($f->crm->calls)->toBe([]);
    expect($f->service->poll())->toBe(0)->and(DB::table('edna_benefit_chat_routes')->count())->toBe(1);
});

test('acknowledgement received after expiry stays durable and cannot authorize a replay', function () {
    $f = benefitsRouteFixture();
    DB::table('edna_benefit_chat_routes')->update(['expires_at' => now()->addSeconds(5)]);
    $f->crm->beforeCall = function ($method) {
        if ($method === 'imopenlines.operator.transfer') {
            $this->travel(10)->seconds();
        }
    };
    expect($f->service->process($f->event->id)['state'])->toBe('review')
        ->and((bool) benefitsRouteRow($f)->transfer_acknowledged)->toBeTrue()->and($f->crm->posts)->toBe(1);
    $f->service->process($f->event->id);
    expect($f->crm->posts)->toBe(1);
});

test('activation is immutable and status never schedules work or reads CRM', function () {
    DB::table('edna_intake_cutovers')->where('name', EdnaBenefitsRouting::NAME)->delete();
    $event = benefitsRouteEvent();
    $this->artisan('edna:benefits-chats activate')->assertSuccessful();
    $cut = DB::table('edna_intake_cutovers')->where('name', EdnaBenefitsRouting::NAME)->first();
    expect((int) $cut->entry_id_after)->toBe($event->id)->and(CarbonImmutable::parse($cut->starts_at)->equalTo(now()->addSecond()))->toBeTrue();
    $this->travel(1)->hour();
    benefitsRouteEvent();
    $this->artisan('edna:benefits-chats activate')->assertSuccessful();
    expect(DB::table('edna_intake_cutovers')->where('name', EdnaBenefitsRouting::NAME)->first())->toEqual($cut);
    $this->artisan('edna:benefits-chats status')->assertSuccessful();
    expect(DB::table('edna_benefit_chat_routes')->count())->toBe(0);
    Queue::assertNothingPushed();
});

test('a proven member campaign reply without a deal respects live attention and has one transfer intent per session', function (string $scenario) {
    $f = benefitsRouteFixture(false);
    $f->cases->status = 'not_applicable';
    $f->crm->dialog['entity_data_1'] = str_replace('DEAL|900', 'CONTACT|710', $f->crm->dialog['entity_data_1']);
    $f->crm->dialog['entity_data_2'] = 'CONTACT|710';
    $label = 'Quiero mis beneficios';
    $event = benefitsRouteEvent(['replyOutMessageId' => '456', 'messageContent' => ['type' => 'BUTTON', 'text' => $label, 'payload' => $label]]);
    $out = ['messageId' => '456', 'subjectId' => '2423', 'matcherId' => '63510', 'sentOrReceivedAt' => now()->subMinute()->toISOString()];
    DB::table('edna_intake_cutovers')->updateOrInsert(['name' => \App\Services\EdnaMemberBenefitsButton::CUTOVER],
        ['entry_id_after' => $scenario === 'old entry' ? $event->id : 0, 'starts_at' => now()->subMinute()]);
    $proof = benefitsRouteProof($event);
    if ($scenario === 'old entry') {
        expect($f->service->reserveMemberButton($event, $proof, $out)['state'])->toBe('review')
            ->and(DB::table('edna_benefit_chat_routes')->count())->toBe(0);
        return;
    }
    if (in_array($scenario, ['existing reservation', 'prior deal changed'], true)) {
        $f->cases->status = 'waiting';
        $f->service->check($f->event, $f->proof);
        if ($scenario === 'prior deal changed') {
            DB::table('edna_benefit_chat_routes')->where('entry_event_id', $f->event->id)
                ->update(['state' => 'preserved', 'reason' => 'benefits_case_changed']);
        }
        $f->cases->status = 'not_applicable';
    }
    $caseReads = $f->cases->calls;
    if ($scenario === 'human at final check') {
        $f->guard->beforeInspect = function ($call) use ($f) { $f->crm->attended = $call === 2; };
    }
    $f->crm->mode = $scenario === 'lost response' ? 'lost_after_apply' : 'ack';
    $f->service->reserveMemberButton($event, $proof, $out);
    $f->service->reserveMemberButton($event, $proof, $out);
    $rowId = DB::table('edna_benefit_chat_routes')->value('entry_event_id');
    $result = $f->service->process($rowId);
    expect($f->service->check($event, $proof)['state'])->toBe('preserved');
    $f->service->reserveMemberButton($event, $proof, $out);
    expect($f->service->process($rowId)['state'])->toBe('not_claimed');
    $row = DB::table('edna_benefit_chat_routes')->first();
    expect(DB::table('edna_benefit_chat_routes')->count())->toBe(1)
        ->and($f->cases->calls)->toBe($caseReads)->and($row->deal_id)->toBeNull();
    if ($scenario === 'human at final check') {
        expect($result['state'])->toBe('preserved')->and($f->crm->posts)->toBe(0)->and($row->transfer_intent)->toBeNull();
    } else {
        expect($result['state'])->toBe('routed')->and($f->crm->posts)->toBe(1)
            ->and($row->transfer_state)->toBe($scenario === 'lost response' ? 'observed' : 'confirmed')
            ->and(json_decode($row->transfer_intent, true)['entry_event_id'])->toBe($event->id);
    }
})->with(['new contact only', 'human at final check', 'existing reservation', 'prior deal changed', 'lost response', 'old entry']);
