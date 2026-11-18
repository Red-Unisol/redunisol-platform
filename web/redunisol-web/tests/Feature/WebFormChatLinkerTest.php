<?php

use App\Services\AttributionJourney;
use App\Services\EdnaBitrix;
use App\Services\EdnaMessageBinding;
use App\Services\JourneyLedger;
use App\Services\WebChatContinuity;
use App\Services\WebFormChatGuard;
use App\Services\WebFormChatLinker;
use App\Services\WebFormReceipt;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 10)->setTime(12, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('l', 32)));
    config()->set('edna.enabled', true);
    config()->set('edna.intake_crm_enabled', true);
    config()->set('edna.subject_id', '2423');
    Http::preventStrayRequests();
    Queue::fake();
});

class WebChatLinkerCrmFake extends EdnaBitrix
{
    public array $calls = [];

    public array $web = ['ID' => '700', 'CONTACT_ID' => '710', 'ASSIGNED_BY_ID' => '90231',
        'STATUS_ID' => 'CONVERTED', 'STATUS_SEMANTIC_ID' => 'S', 'UF_CRM_1693840106704' => '20301234563'];

    public array $native = ['ID' => '101', 'CONTACT_ID' => '0', 'ASSIGNED_BY_ID' => '57', 'CREATED_BY_ID' => '57',
        'STATUS_ID' => 'NEW', 'UF_CRM_1693840106704' => ''];

    public array $contact = ['ID' => '710', 'ASSIGNED_BY_ID' => '71283', 'UF_CRM_65B7E48033FCD' => '20301234563'];

    public array $deal = ['ID' => '900', 'LEAD_ID' => '700', 'CONTACT_ID' => '710', 'ASSIGNED_BY_ID' => '90231',
        'CATEGORY_ID' => '1', 'STAGE_ID' => 'C1:NEW', 'STAGE_SEMANTIC_ID' => 'P'];

    public array $dialog = ['id' => 601, 'owner' => 0, 'entity_type' => 'LINES', 'entity_id' => 'whatsappbyedna|1|5493510000000@2423|999',
        'entity_data_1' => 'Y|LEAD|101|N|N|501|1794333600|0|0|0', 'entity_data_2' => 'LEAD|101|CONTACT|0|COMPANY|0|DEAL|0',
        'text_field_enabled' => true];

    public array $bindings = [['entityTypeId' => 1, 'entityId' => 101]];

    public bool $dealPending = false;

    public string $transferMode = 'ack';

    public int $transferCalls = 0;

    public int $sessionId = 501;

    public int $activityOwnerType = 1;

    public string $activityOwnerId = '101';

    public ?Closure $beforeCall = null;

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = [$method, $payload];
        if ($this->beforeCall) {
            ($this->beforeCall)($method, $payload);
        }

        return match ($method) {
            'crm.lead.get' => (string) $payload['id'] === '700' ? $this->web : $this->native,
            'crm.contact.get' => $this->contact,
            'crm.deal.list' => $this->dealPending ? [] : [$this->deal],
            'crm.deal.get' => $this->deal,
            'user.get' => [['ID' => (string) $payload['ID'], 'ACTIVE' => true, 'UF_DEPARTMENT' => [1]]],
            'crm.activity.get' => ['ID' => (string) $payload['id'], 'PROVIDER_ID' => 'IMOPENLINES_SESSION', 'ASSOCIATED_ENTITY_ID' => (string) $this->sessionId,
                'OWNER_TYPE_ID' => $this->activityOwnerType, 'OWNER_ID' => $this->activityOwnerId],
            'crm.activity.binding.list' => $this->bindings,
            'crm.activity.binding.add' => $this->addBinding($payload),
            'imopenlines.dialog.get' => $this->dialog,
            'imopenlines.operator.transfer' => $this->transfer($payload),
            'batch' => $this->batch($payload),
            default => throw new RuntimeException('Unexpected CRM operation in linker fixture: '.$method),
        };
    }

    private function addBinding(array $payload): bool
    {
        $binding = ['entityTypeId' => $payload['entityTypeId'], 'entityId' => $payload['entityId']];
        if (! in_array($binding, $this->bindings, true)) {
            $this->bindings[] = $binding;
        }

        return true;
    }

    private function transfer(array $payload): bool
    {
        $this->transferCalls++;
        if ($this->transferMode !== 'lost_without_apply') {
            $this->dialog['owner'] = (int) $payload['USER_ID'];
            // Emulate Bitrix's existing native Guest side effect, without editing
            // the pre-existing website lead, contact or negotiation.
            $this->native['ASSIGNED_BY_ID'] = (string) $payload['USER_ID'];
        }
        if ($this->transferMode !== 'ack') {
            throw new RuntimeException('A response was lost after a bounded provider request.');
        }

        return true;
    }

    private function batch(array $payload): array
    {
        $result = [];
        foreach ($payload['cmd'] as $key => $command) {
            [$method, $query] = explode('?', $command, 2);
            parse_str($query, $params);
            $result[$key] = $this->call($method, $params);
        }

        return ['result' => $result, 'result_error' => []];
    }
}

class WebChatLinkerBindingFake extends EdnaMessageBinding
{
    public ?array $proof = null;

    public int $calls = 0;

    public int $receiptCalls = 0;

    public bool $receiptMiss = false;

    public array $receiptLeadIds = [];

    public function resolveReceipt(object $event, array $payload, int $receiptLeadId): ?array
    {
        $this->receiptCalls++;
        $this->receiptLeadIds[] = $receiptLeadId;

        return $this->receiptMiss ? null : $this->proof;
    }

    public function resolveCurrent(object $event, array $payload, ?int $knownChatId = null): ?array
    {
        $this->calls++;

        return $this->proof;
    }

    public function resolve(object $event, array $payload, ?int $knownChatId = null): ?array
    {
        $this->calls++;

        return $this->proof;
    }
}

class WebChatLinkerGuardFake extends WebFormChatGuard
{
    public int $calls = 0;

    public ?string $status = null;

    public ?Closure $beforeInspect = null;

    public function __construct(public WebChatLinkerCrmFake $fake) {}

    public function inspect(array $proof, string $sellerId): array
    {
        $this->calls++;
        if ($this->beforeInspect) {
            ($this->beforeInspect)($this->calls);
        }
        $owner = (int) $this->fake->dialog['owner'];
        $status = $this->status ?? ($owner === (int) $sellerId ? 'already_assigned' : ($owner !== 0 ? 'preserved' : 'ready'));

        return ['status' => $status, 'reason' => $status === 'ready' ? 'unattended_sales_session' : 'test_attention_preserved',
            'owner_id' => $owner, 'session_id' => $this->fake->sessionId, 'dialog' => $this->fake->dialog];
    }
}

function webChatLinkerEvent(): object
{
    $message = (string) (130000 + DB::table('edna_incoming_events')->count());
    $payload = ['id' => $message, 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => now()->toIso8601String(), 'messageContent' => ['type' => 'TEXT', 'text' => 'Continuar solicitud']];
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423', 'message_id' => $message,
        'payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR)), 'status' => 'delivered',
        'created_at' => now(), 'updated_at' => now()]);

    return DB::table('edna_incoming_events')->find($id);
}

function webChatLinkerProof(object $event, int $session = 501, int $chat = 601): array
{
    return ['version' => 1, 'source' => 'bitrix_openline_session', 'verified' => true, 'evidence' => 'external_message_id',
        'entry_event_id' => $event->id, 'entry_message_id' => $event->message_id,
        'chat_id' => (string) $chat, 'session_id' => (string) $session, 'message_id' => (string) ($session + 200),
        'activity_id' => (string) ($session + 300), 'native_lead_id' => '101'];
}

function webChatLinkerRoute(object $event, ?string $submission, string $proofSource = 'reference'): void
{
    DB::table('web_form_continuations')->insert(['entry_event_id' => $event->id, 'submission_id' => $submission,
        'state' => $proofSource === 'reentry' ? 'waiting' : 'ready', 'reason' => $proofSource === 'reentry' ? 'web_chat_reentry' : 'web_form_already_processed',
        'proof_source' => $proofSource, 'lead_id' => $submission ? '700' : null, 'created_at' => now(), 'updated_at' => now()]);
    DB::table('web_form_chat_routes')->insert(['entry_event_id' => $event->id, 'submission_id' => $submission,
        'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'), 'state' => 'pending',
        'created_at' => now(), 'updated_at' => now()]);
}

function webChatLinkerFixture(): object
{
    $submission = (string) Str::uuid();
    $input = ['celular' => '3510000000', 'cuil' => '20301234563', '_journey_links' => ['submission_id' => $submission]];
    app(WebFormReceipt::class)->register($input);
    app(WebFormReceipt::class)->result($input, ['ok' => true, 'lead_id' => '700', 'contact_id' => '710'], true);
    $event = webChatLinkerEvent();
    webChatLinkerRoute($event, $submission);
    $crm = new WebChatLinkerCrmFake;
    $binding = new WebChatLinkerBindingFake;
    $binding->proof = webChatLinkerProof($event);
    $guard = new WebChatLinkerGuardFake($crm);

    return (object) ['event' => $event, 'submission' => $submission, 'crm' => $crm, 'binding' => $binding, 'guard' => $guard,
        'linker' => new WebFormChatLinker($crm, $binding, $guard)];
}

function webChatLinkerRow(object $fixture): object
{
    return DB::table('web_form_chat_routes')->where('entry_event_id', $fixture->event->id)->first();
}

class WebChatLinkerContinuityFake extends WebChatContinuity
{
    public bool $eligible = true;

    public int $eligibilityCalls = 0;

    public array $binds = [];

    public array $observations = [];

    public ?Closure $beforeBind = null;

    public array $decision = ['status' => 'bound', 'reason' => 'web_context_session_verified', 'context_id' => 101];

    public function eligibleEntry(object $event): bool
    {
        $this->eligibilityCalls++;

        return $this->eligible;
    }

    public function bind(int $entryId, array $proof): array
    {
        $this->binds[] = [$entryId, $proof];
        if ($this->beforeBind) {
            ($this->beforeBind)(count($this->binds));
        }

        return $this->decision;
    }

    public function sync(int $entryId, string $state, string $reason, array $fields = []): void
    {
        $this->observations[] = compact('entryId', 'state', 'reason', 'fields');
    }
}

function webChatContextLinkerFixture(): object
{
    $f = webChatLinkerFixture();
    $f->context = new WebChatLinkerContinuityFake;
    app()->instance(WebChatContinuity::class, $f->context);
    DB::table('web_chat_contexts')->insert(['id' => 101, 'subject_id' => '2423',
        'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'), 'anchor_entry_event_id' => $f->event->id,
        'submission_id' => $f->submission, 'state' => 'bound', 'expires_at' => now()->addHours(8),
        'last_entry_event_id' => $f->event->id, 'created_at' => now(), 'updated_at' => now()]);
    DB::table('web_form_continuations')->where('entry_event_id', $f->event->id)->update([
        'context_id' => 101, 'proof_source' => 'web_context',
    ]);
    $f->crm->web['PHONE'] = [['VALUE' => '5493510000000']];
    $f->crm->web['ASSIGNED_BY_ID'] = '29'; // Historical converted lead; the current deal has its own seller.
    $f->crm->activityOwnerType = 2;
    $f->crm->activityOwnerId = '900';
    $f->crm->dialog['entity_data_1'] = 'Y|DEAL|900|N|N|501|1794333600|0|0|0';
    $f->crm->dialog['entity_data_2'] = 'LEAD|0|CONTACT|710|COMPANY|0|DEAL|900';
    $f->binding->proof['native_lead_id'] = null;
    $f->crm->bindings = [['entityTypeId' => 2, 'entityId' => 900]];

    return $f;
}

test('a new web context survives qualifier conversion and routes to its exact current deal seller', function () {
    $f = webChatContextLinkerFixture();
    $before = [$f->crm->web, $f->crm->contact, $f->crm->deal];
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'routed', 'reason' => 'assigned_seller_confirmed'])
        ->and($f->crm->transferCalls)->toBe(1)->and($f->binding->receiptLeadIds)->toBe([700])
        ->and([$f->crm->web, $f->crm->contact, $f->crm->deal])->toBe($before)
        ->and($f->context->binds)->toHaveCount(3)
        ->and($f->context->observations[0]['fields'])->toMatchArray(['transfer_state' => 'confirmed', 'transfer_acknowledged' => true]);
    expect(json_decode(webChatLinkerRow($f)->proof, true)['transfer_intent'])->toMatchArray([
        'web_owner_before' => '29', 'web_lead_converted' => true, 'seller_id' => '90231',
    ]);
});

test('the 121095 ordering waits for qualification then observes its assigned deal without a second handoff', function () {
    $f = webChatContextLinkerFixture();
    $f->crm->web['STATUS_ID'] = 'NEW';
    $f->crm->web['STATUS_SEMANTIC_ID'] = 'P';
    $f->crm->dealPending = true;
    $f->binding->proof['native_lead_id'] = '700';
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'waiting', 'reason' => 'commercial_case_not_ready']);
    $this->travelTo(CarbonImmutable::parse(webChatLinkerRow($f)->available_at)->addSecond());
    $f->crm->web['STATUS_ID'] = 'CONVERTED';
    $f->crm->web['STATUS_SEMANTIC_ID'] = 'S';
    $f->crm->dealPending = false;
    $f->crm->dialog['owner'] = 90231;
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'routed', 'reason' => 'already_with_assigned_seller'])
        ->and($f->crm->transferCalls)->toBe(0)->and($f->binding->receiptCalls)->toBe(1)
        ->and($f->context->binds)->toHaveCount(2)
        ->and(array_column($f->context->observations, 'state'))->toBe(['waiting', 'routed'])
        ->and($f->context->observations[1]['fields']['transfer_state'])->toBe('not_needed')
        ->and($f->context->observations[1]['fields']['transfer_acknowledged'])->toBeFalse();
});

test('an already assigned converted web chat is observed without inventing another transfer or CRM write', function () {
    $f = webChatContextLinkerFixture();
    $f->crm->dialog['owner'] = 90231;
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'routed', 'reason' => 'already_with_assigned_seller'])
        ->and($f->crm->transferCalls)->toBe(0)->and(webChatLinkerRow($f)->transfer_state)->toBe('not_needed')
        ->and(array_filter($f->crm->calls, fn ($call) => $call[0] === 'crm.activity.binding.add'))->toBe([])
        ->and($f->context->observations[0]['fields']['transfer_acknowledged'])->toBeFalse();
    expect(json_decode(webChatLinkerRow($f)->proof, true))->not->toHaveKey('transfer_intent');
});

test('a cached proof from before qualifier conversion remains valid only for the exact current deal primary', function () {
    $f = webChatContextLinkerFixture();
    $f->binding->proof['native_lead_id'] = '700';
    DB::table('web_form_chat_routes')->where('entry_event_id', $f->event->id)->update([
        'proof' => json_encode($f->binding->proof, JSON_THROW_ON_ERROR),
    ]);
    expect($f->linker->process($f->event->id)['state'])->toBe('routed')
        ->and($f->crm->transferCalls)->toBe(1)->and($f->binding->receiptCalls)->toBe(0)
        ->and($f->crm->web['ASSIGNED_BY_ID'])->toBe('29');
});

test('a converted historical proof does not relax another native Guest or a lead primary', function (string $kind) {
    $f = webChatContextLinkerFixture();
    if ($kind === 'other Guest') {
        $f->binding->proof['native_lead_id'] = '101';
        $f->crm->native['ASSIGNED_BY_ID'] = '29';
    } else {
        $f->binding->proof['native_lead_id'] = '700';
        $f->crm->dialog['entity_data_1'] = 'Y|LEAD|700|N|N|501|1794333600|0|0|0';
    }
    expect($f->linker->process($f->event->id)['reason'])->toBe('native_crm_assignment_preserved')
        ->and($f->crm->transferCalls)->toBe(0)
        ->and(array_filter($f->crm->calls, fn ($call) => $call[0] === 'crm.activity.binding.add'))->toBe([]);
})->with(['other Guest', 'lead primary']);

test('a late primary change cancels a transfer relying on a historical converted lead', function () {
    $f = webChatContextLinkerFixture();
    $f->binding->proof['native_lead_id'] = '700';
    $f->crm->beforeCall = function ($method) use ($f) {
        if ($method === 'batch') {
            $f->crm->dialog['entity_data_1'] = 'Y|LEAD|700|N|N|501|1794333600|0|0|0';
        }
    };
    expect($f->linker->process($f->event->id)['reason'])->toBe('converted_native_case_changed')
        ->and($f->crm->transferCalls)->toBe(0);
});

test('a taken context chat is preserved before even adding activity bindings', function () {
    $f = webChatContextLinkerFixture();
    $f->guard->status = 'preserved';
    expect($f->linker->process($f->event->id)['state'])->toBe('preserved')
        ->and($f->crm->transferCalls)->toBe(0)
        ->and(array_filter($f->crm->calls, fn ($call) => $call[0] === 'crm.activity.binding.add'))->toBe([]);
});

test('unverified released or ambiguous context binding cannot cause CRM writes', function (string $status) {
    $f = webChatContextLinkerFixture();
    $f->context->decision['status'] = $status;
    expect($f->linker->process($f->event->id)['state'])->toBe($status === 'review' ? 'review' : 'preserved')
        ->and($f->crm->transferCalls)->toBe(0)
        ->and(array_filter($f->crm->calls, fn ($call) => in_array($call[0], ['crm.activity.binding.add', 'imopenlines.operator.transfer'], true)))->toBe([]);
})->with(['review', 'released', 'preserved']);

test('a context cannot activate linking on a pre-cutover or unauthenticated entry', function () {
    $f = webChatContextLinkerFixture();
    $f->context->eligible = false;
    expect($f->linker->process($f->event->id)['reason'])->toBe('web_context_entry_not_verified')
        ->and($f->context->binds)->toBe([])->and($f->context->observations)->toBe([])
        ->and($f->crm->calls)->toBe([]);
});

test('context expiry during native attention reads stops all CRM mutations even on a newer route', function () {
    $f = webChatContextLinkerFixture();
    DB::table('web_chat_contexts')->where('id', 101)->update(['expires_at' => now()->addSeconds(5)]);
    $f->guard->beforeInspect = function ($count) {
        if ($count === 1) {
            $this->travel(10)->seconds();
        }
    };
    expect($f->linker->process($f->event->id)['state'])->toBe('expired')
        ->and($f->crm->transferCalls)->toBe(0)
        ->and(array_filter($f->crm->calls, fn ($call) => $call[0] === 'crm.activity.binding.add'))->toBe([]);
});

test('a positive transfer acknowledgement after context expiry remains durable and is never replayed', function () {
    $f = webChatContextLinkerFixture();
    DB::table('web_chat_contexts')->where('id', 101)->update(['expires_at' => now()->addSeconds(5)]);
    $f->crm->beforeCall = function ($method) {
        if ($method === 'imopenlines.operator.transfer') {
            $this->travel(10)->seconds();
        }
    };
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'review', 'reason' => 'transfer_unresolved_after_retry_window'])
        ->and(json_decode(webChatLinkerRow($f)->proof, true)['transfer_acknowledged'])->toBeTrue()
        ->and($f->crm->transferCalls)->toBe(1)
        ->and(array_slice(array_column($f->crm->calls, 0), -1))->toBe(['imopenlines.operator.transfer']);
    expect($f->linker->process($f->event->id)['state'])->toBe('not_claimed')->and($f->crm->transferCalls)->toBe(1);
});

test('another web submission discovered during binding reads stops before the first CRM mutation', function () {
    $f = webChatContextLinkerFixture();
    $f->crm->beforeCall = function ($method) use ($f) {
        if ($method === 'crm.activity.binding.list') {
            $f->context->decision['status'] = 'review';
            $f->context->decision['reason'] = 'web_context_multiple_submissions';
        }
    };
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'review', 'reason' => 'web_context_multiple_submissions'])
        ->and($f->crm->transferCalls)->toBe(0)
        ->and(array_filter($f->crm->calls, fn ($call) => $call[0] === 'crm.activity.binding.add'))->toBe([]);
});

test('context ambiguity found by the final bind stops the POST before persisting a transfer intent', function () {
    $f = webChatContextLinkerFixture();
    $f->context->beforeBind = function ($count) use ($f) {
        if ($count === 3) {
            $f->context->decision['status'] = 'review';
            $f->context->decision['reason'] = 'web_context_multiple_submissions';
        }
    };
    expect($f->linker->process($f->event->id)['state'])->toBe('review')->and($f->crm->transferCalls)->toBe(0)
        ->and(json_decode(webChatLinkerRow($f)->proof, true))->not->toHaveKey('transfer_intent');
});

test('a malformed converted activity relation cannot apply another deal or person', function (string $change) {
    $f = webChatContextLinkerFixture();
    match ($change) {
        'activity deal' => $f->crm->activityOwnerId = '901',
        'activity contact' => [$f->crm->activityOwnerType, $f->crm->activityOwnerId] = [3, '711'],
        'deal category' => $f->crm->deal['CATEGORY_ID'] = '5',
        'deal lead' => $f->crm->deal['LEAD_ID'] = '701',
        'deal contact' => $f->crm->deal['CONTACT_ID'] = '711',
    };
    expect($f->linker->process($f->event->id)['state'])->toBeIn(['review', 'preserved'])
        ->and($f->crm->transferCalls)->toBe(0)
        ->and(array_filter($f->crm->calls, fn ($call) => $call[0] === 'crm.activity.binding.add'))->toBe([]);
})->with(['activity deal', 'activity contact', 'deal category', 'deal lead', 'deal contact']);

test('a final converted activity change cancels the handoff', function () {
    $f = webChatContextLinkerFixture();
    $f->crm->beforeCall = function ($method) use ($f) {
        if ($method === 'batch') {
            $f->crm->activityOwnerId = '901';
        }
    };
    expect($f->linker->process($f->event->id)['reason'])->toBe('native_activity_case_preserved')
        ->and($f->crm->transferCalls)->toBe(0);
});

test('a receipt hint is not used after its current CUIL or phone identity changes', function (string $field) {
    $f = webChatContextLinkerFixture();
    $f->crm->web[$field] = $field === 'PHONE' ? [['VALUE' => '5493519999999']] : '20234567860';
    expect($f->linker->process($f->event->id)['state'])->toBe('review')
        ->and($f->binding->receiptCalls)->toBe(0)->and($f->crm->transferCalls)->toBe(0);
})->with(['PHONE', 'UF_CRM_1693840106704']);

test('a rejected web context retains native evidence for the separate verified notice closer', function () {
    $f = webChatContextLinkerFixture();
    $f->crm->web['STATUS_ID'] = 'UC_1P8I07';
    $f->crm->web['STATUS_SEMANTIC_ID'] = 'F';
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'review', 'reason' => 'web_case_rejected'])
        ->and(webChatLinkerRow($f)->proof)->not->toBeNull()->and($f->context->binds)->toHaveCount(1)
        ->and($f->crm->transferCalls)->toBe(0)
        ->and(array_filter($f->crm->calls, fn ($call) => $call[0] === 'crm.activity.binding.add'))->toBe([]);
});

test('a late deal category change also prevents transfer when its native activity still belongs to a Guest', function () {
    $f = webChatContextLinkerFixture();
    $f->binding->proof['native_lead_id'] = '101';
    $f->crm->activityOwnerType = 1;
    $f->crm->activityOwnerId = '101';
    $f->crm->beforeCall = function ($method) use ($f) {
        if ($method === 'batch') {
            $f->crm->deal['CATEGORY_ID'] = '5';
        }
    };
    expect($f->linker->process($f->event->id)['reason'])->toBe('commercial_assignment_changed')
        ->and($f->crm->transferCalls)->toBe(0);
});

test('a missing current native message waits without anchoring or borrowing another context', function () {
    $f = webChatContextLinkerFixture();
    $f->binding->receiptMiss = true;
    $f->binding->proof = null;
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'waiting', 'reason' => 'native_message_pending'])
        ->and($f->context->binds)->toBe([])->and($f->crm->transferCalls)->toBe(0);
});

test('legacy routes never join or synchronize a new web context', function () {
    $f = webChatLinkerFixture();
    $context = new WebChatLinkerContinuityFake;
    app()->instance(WebChatContinuity::class, $context);
    expect($f->linker->process($f->event->id)['state'])->toBe('routed')
        ->and($context->eligibilityCalls)->toBe(0)->and($context->binds)->toBe([])->and($context->observations)->toBe([])
        ->and(DB::table('web_form_continuations')->value('context_id'))->toBeNull();
});

test('the existing web case receives the native activity and a single transfer without creating or reassigning CRM records', function () {
    $f = webChatLinkerFixture();
    $before = [$f->crm->web, $f->crm->contact, $f->crm->deal];
    expect($f->linker->process($f->event->id)['state'])->toBe('routed')
        ->and($f->crm->transferCalls)->toBe(1)->and($f->crm->bindings)->toContain(
            ['entityTypeId' => 3, 'entityId' => 710], ['entityTypeId' => 2, 'entityId' => 900])
        ->and([$f->crm->web, $f->crm->contact, $f->crm->deal])->toBe($before)
        ->and(webChatLinkerRow($f)->link_state)->toBe('linked');
    foreach ($f->crm->calls as [$method]) {
        expect($method)->not->toBeIn(['crm.lead.add', 'crm.deal.add', 'crm.contact.add', 'crm.lead.update',
            'crm.deal.update', 'crm.contact.update', 'crm.item.update', 'imopenlines.session.start', 'im.message.add']);
    }
    expect($f->linker->process($f->event->id)['state'])->toBe('not_claimed')->and($f->crm->transferCalls)->toBe(1);
});

test('human attention discovered after linking preserves the chat and all CRM responsible people', function () {
    $f = webChatLinkerFixture();
    $f->guard->beforeInspect = function ($call) use ($f) {
        if ($call === 2) {
            $f->crm->dialog['owner'] = 29;
        }
    };
    expect($f->linker->process($f->event->id)['state'])->toBe('preserved')
        ->and($f->crm->transferCalls)->toBe(0)->and($f->crm->dialog['owner'])->toBe(29)
        ->and($f->crm->deal['ASSIGNED_BY_ID'])->toBe('90231')->and(webChatLinkerRow($f)->link_state)->toBe('linked');
});

test('a last moment manual chat owner change in the final read prevents the POST', function () {
    $f = webChatLinkerFixture();
    $f->crm->beforeCall = function ($method) use ($f) {
        if ($method === 'batch') {
            $f->crm->dialog['owner'] = 29;
        }
    };
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'preserved', 'reason' => 'chat_assignment_changed'])
        ->and($f->crm->transferCalls)->toBe(0);
});

test('a new commercial assignment after activity binding is preserved', function () {
    $f = webChatLinkerFixture();
    $f->crm->beforeCall = function ($method, $params) use ($f) {
        if ($method === 'crm.activity.binding.add' && $params['entityTypeId'] === 2) {
            $f->crm->web['ASSIGNED_BY_ID'] = '71159';
            $f->crm->deal['ASSIGNED_BY_ID'] = '71159';
        }
    };
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'preserved', 'reason' => 'commercial_assignment_changed'])
        ->and($f->crm->transferCalls)->toBe(0)->and($f->crm->deal['ASSIGNED_BY_ID'])->toBe('71159');
});

test('a closed native session is linked for continuity without reopening or transferring it', function () {
    $f = webChatLinkerFixture();
    $f->guard->status = 'closed';
    expect($f->linker->process($f->event->id)['state'])->toBe('linked')
        ->and($f->crm->transferCalls)->toBe(0)->and(webChatLinkerRow($f)->link_state)->toBe('linked');
});

test('pre-existing activity bindings to another case or person require review', function (int $type, int $id) {
    $f = webChatLinkerFixture();
    $f->crm->bindings[] = ['entityTypeId' => $type, 'entityId' => $id];
    $before = $f->crm->bindings;
    expect($f->linker->process($f->event->id)['state'])->toBe('review')
        ->and($f->crm->bindings)->toBe($before)->and($f->crm->transferCalls)->toBe(0);
})->with([[2, 999], [3, 777]]);

test('web native and contact identity conflicts cannot cause a handoff', function (string $record, string $field) {
    $f = webChatLinkerFixture();
    $f->crm->{$record}[$field] = '20123456786';
    expect($f->linker->process($f->event->id)['state'])->toBe('review')
        ->and($f->crm->transferCalls)->toBe(0);
})->with([['web', 'UF_CRM_1693840106704'], ['native', 'UF_CRM_1693840106704'], ['contact', 'UF_CRM_65B7E48033FCD']]);

test('a separate manual contact responsible person is preserved', function () {
    $f = webChatLinkerFixture();
    $f->crm->contact['ASSIGNED_BY_ID'] = '29';
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'preserved', 'reason' => 'contact_responsible_preserved'])
        ->and($f->crm->transferCalls)->toBe(0)->and($f->crm->contact['ASSIGNED_BY_ID'])->toBe('29');
});

test('a native lead reassigned to another provisional-looking user is preserved before any CRM write', function (string $owner, string $creator) {
    $f = webChatLinkerFixture();
    $f->crm->native['ASSIGNED_BY_ID'] = $owner;
    $f->crm->native['CREATED_BY_ID'] = $creator;
    $before = $f->crm->bindings;
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'preserved', 'reason' => 'native_crm_assignment_preserved'])
        ->and($f->crm->native['ASSIGNED_BY_ID'])->toBe($owner)
        ->and($f->crm->bindings)->toBe($before)->and($f->crm->transferCalls)->toBe(0)
        ->and($f->guard->calls)->toBe(0)
        ->and(array_filter($f->crm->calls, fn ($call) => $call[0] === 'crm.activity.binding.add'))->toBe([]);
})->with([['74827', '57'], ['71283', '57'], ['71283', '71283'], ['57', '']]);

test('a new native Guest still assigned to its Nico receiver can reach its commercial seller', function () {
    $f = webChatLinkerFixture();
    $f->crm->native['CREATED_BY_ID'] = '74827';
    $f->crm->native['ASSIGNED_BY_ID'] = '74827';
    expect($f->linker->process($f->event->id)['state'])->toBe('routed')
        ->and($f->crm->transferCalls)->toBe(1)->and($f->crm->dialog['owner'])->toBe(90231);
});

test('late identity ownership or native case changes stop the final handoff', function (string $change) {
    $f = webChatLinkerFixture();
    $f->crm->beforeCall = function ($method) use ($f, $change) {
        if ($method !== 'batch') {
            return;
        }
        match ($change) {
            'native_identity' => $f->crm->native['UF_CRM_1693840106704'] = '20123456786',
            'native_contact' => $f->crm->native['CONTACT_ID'] = '777',
            'contact_identity' => $f->crm->contact['UF_CRM_65B7E48033FCD'] = '20123456786',
            'contact_owner' => $f->crm->contact['ASSIGNED_BY_ID'] = '29',
            'native_case' => $f->crm->dialog['entity_data_2'] = 'LEAD|999|CONTACT|0|COMPANY|0|DEAL|0',
        };
    };
    expect($f->linker->process($f->event->id)['state'])->toBeIn(['preserved', 'review'])
        ->and($f->crm->transferCalls)->toBe(0);
})->with(['native_identity', 'native_contact', 'contact_identity', 'contact_owner', 'native_case']);

test('acceptance without an owner change still prevents transfer in the integration', function () {
    $f = webChatLinkerFixture();
    $f->guard->status = 'preserved';
    expect($f->linker->process($f->event->id)['state'])->toBe('preserved')
        ->and($f->crm->dialog['owner'])->toBe(0)->and($f->crm->transferCalls)->toBe(0);
});

test('a successful activity binding with a lost response is read back rather than duplicated', function () {
    $f = webChatLinkerFixture();
    $f->crm->beforeCall = function ($method, $params) use ($f) {
        if ($method === 'crm.activity.binding.add' && $params['entityTypeId'] === 3) {
            $f->crm->bindings[] = ['entityTypeId' => 3, 'entityId' => 710];
            throw new RuntimeException('Provider applied binding but its response was lost.');
        }
    };
    expect($f->linker->process($f->event->id)['state'])->toBe('routed')
        ->and(count(array_filter($f->crm->calls, fn ($call) => $call[0] === 'crm.activity.binding.add' && $call[1]['entityTypeId'] === 3)))->toBe(1)
        ->and($f->crm->transferCalls)->toBe(1);
});

test('an applied transfer with a lost response is reconciled without sending it again', function () {
    $f = webChatLinkerFixture();
    $f->crm->transferMode = 'lost_after_apply';
    expect($f->linker->process($f->event->id)['state'])->toBe('routed')->and($f->crm->transferCalls)->toBe(1)
        ->and($f->linker->process($f->event->id)['state'])->toBe('not_claimed')->and($f->crm->transferCalls)->toBe(1);
});

test('an unapplied uncertain POST remains read-only on future attempts', function () {
    $f = webChatLinkerFixture();
    $f->crm->transferMode = 'lost_without_apply';
    expect($f->linker->process($f->event->id)['state'])->toBe('unknown')->and($f->crm->transferCalls)->toBe(1);
    test()->travel(6)->minutes();
    expect($f->linker->process($f->event->id)['state'])->toBe('unknown')->and($f->crm->transferCalls)->toBe(1);
});

test('another active lease prevents duplicate processing', function () {
    $f = webChatLinkerFixture();
    DB::table('web_form_chat_routes')->update(['lease_token' => (string) Str::uuid(), 'lease_until' => now()->addMinute()]);
    expect($f->linker->process($f->event->id)['state'])->toBe('not_claimed')
        ->and($f->binding->calls)->toBe(0)->and($f->crm->calls)->toBe([]);
});

test('a superseded worker cannot write after another worker takes its lease', function () {
    $f = webChatLinkerFixture();
    $newToken = (string) Str::uuid();
    $f->crm->beforeCall = function ($method) use ($f, $newToken) {
        if ($method === 'crm.activity.binding.list') {
            DB::table('web_form_chat_routes')->where('entry_event_id', $f->event->id)->update([
                'lease_token' => $newToken, 'lease_until' => now()->addMinutes(2),
            ]);
        }
    };
    expect($f->linker->process($f->event->id)['state'])->toBe('superseded')
        ->and(webChatLinkerRow($f)->lease_token)->toBe($newToken)->and($f->crm->transferCalls)->toBe(0)
        ->and(array_filter($f->crm->calls, fn ($call) => $call[0] === 'crm.activity.binding.add'))->toBe([]);
});

test('web persistence and the commercial decision can finish after the incoming message', function (string $pending) {
    $f = webChatLinkerFixture();
    if ($pending === 'web') {
        DB::table('web_form_receipts')->update(['state' => 'pending']);
    } else {
        $f->crm->dealPending = true;
    }
    expect($f->linker->process($f->event->id)['state'])->toBe('waiting')->and($f->crm->transferCalls)->toBe(0);
    DB::table('web_form_receipts')->update(['state' => 'synced']);
    $f->crm->dealPending = false;
    test()->travel(61)->seconds();
    expect($f->linker->process($f->event->id)['state'])->toBe('routed')->and($f->crm->transferCalls)->toBe(1);
})->with(['web', 'deal']);

test('a later unreferenced message reuses only the proven chat case and survives a waiting retry', function () {
    $f = webChatLinkerFixture();
    expect($f->linker->process($f->event->id)['state'])->toBe('routed');
    test()->travel(2)->days();
    $entry = webChatLinkerEvent();
    webChatLinkerRoute($entry, null, 'reentry');
    $f->binding->proof = webChatLinkerProof($entry, 502);
    $f->crm->sessionId = 502;
    $f->crm->dialog['owner'] = 0;
    $f->crm->dialog['entity_data_1'] = str_replace('|501|', '|502|', $f->crm->dialog['entity_data_1']);
    $f->crm->dealPending = true;
    expect($f->linker->process($entry->id)['state'])->toBe('waiting')
        ->and(DB::table('web_form_chat_routes')->where('entry_event_id', $entry->id)->value('submission_id'))->toBe($f->submission);
    $f->crm->dealPending = false;
    test()->travel(61)->seconds();
    expect($f->linker->process($entry->id)['state'])->toBe('routed')->and($f->crm->transferCalls)->toBe(2)
        ->and(DB::table('web_form_receipts')->count())->toBe(1);
});

test('a shared phone cannot apply another chats historical request', function () {
    $f = webChatLinkerFixture();
    expect($f->linker->process($f->event->id)['state'])->toBe('routed');
    $entry = webChatLinkerEvent();
    webChatLinkerRoute($entry, null, 'reentry');
    $f->binding->proof = webChatLinkerProof($entry, 502, 999);
    expect($f->linker->process($entry->id))->toMatchArray(['state' => 'review', 'reason' => 'reentry_case_not_unique'])
        ->and($f->crm->transferCalls)->toBe(1);
});

test('a protected queue operator remains protected on reopening until the commercial assignment agrees', function () {
    $f = webChatLinkerFixture();
    $f->crm->dialog['owner'] = 74827;
    expect($f->linker->process($f->event->id)['state'])->toBe('preserved')
        ->and(json_decode(webChatLinkerRow($f)->proof, true))->toMatchArray([
            'protected_assignment' => true, 'protected_owner_id' => '74827',
        ])->and($f->crm->transferCalls)->toBe(0);

    test()->travel(2)->days();
    $entry = webChatLinkerEvent();
    webChatLinkerRoute($entry, null, 'reentry');
    $f->binding->proof = webChatLinkerProof($entry, 502);
    $f->crm->sessionId = 502;
    $f->crm->dialog['owner'] = 0;
    $f->crm->dialog['entity_data_1'] = str_replace('|501|', '|502|', $f->crm->dialog['entity_data_1']);
    expect($f->linker->process($entry->id))->toMatchArray(['state' => 'preserved', 'reason' => 'prior_manual_assignment_preserved'])
        ->and($f->crm->transferCalls)->toBe(0);

    // A later explicit CRM assignment to Nico supplies the compatible commercial
    // destination. The persisted protection must not send the chat to the old seller.
    $f->crm->web['ASSIGNED_BY_ID'] = '74827';
    $f->crm->deal['ASSIGNED_BY_ID'] = '74827';
    $next = webChatLinkerEvent();
    webChatLinkerRoute($next, null, 'reentry');
    $f->binding->proof = webChatLinkerProof($next, 503);
    $f->crm->sessionId = 503;
    $f->crm->dialog['entity_data_1'] = str_replace('|502|', '|503|', $f->crm->dialog['entity_data_1']);
    expect($f->linker->process($next->id)['state'])->toBe('routed')
        ->and($f->crm->transferCalls)->toBe(1)->and($f->crm->dialog['owner'])->toBe(74827)
        ->and(json_decode(DB::table('web_form_chat_routes')->where('entry_event_id', $next->id)->value('proof'), true))
        ->toMatchArray(['protected_assignment' => false, 'protection_released' => true]);
});

test('a later waiting or closed record cannot hide a protected human destination', function (string $middleState) {
    $f = webChatLinkerFixture();
    $f->crm->dialog['owner'] = 74827;
    expect($f->linker->process($f->event->id)['state'])->toBe('preserved');
    test()->travel(2)->minutes();
    $middle = webChatLinkerEvent();
    webChatLinkerRoute($middle, $f->submission);
    DB::table('web_form_chat_routes')->where('entry_event_id', $middle->id)->update([
        'state' => $middleState, 'proof' => json_encode(webChatLinkerProof($middle, 502), JSON_THROW_ON_ERROR),
        'link_state' => $middleState === 'linked' ? 'linked' : 'pending',
    ]);
    test()->travel(1)->minute();
    $entry = webChatLinkerEvent();
    webChatLinkerRoute($entry, null, 'reentry');
    $f->binding->proof = webChatLinkerProof($entry, 503);
    $f->crm->sessionId = 503;
    $f->crm->dialog['owner'] = 0;
    $f->crm->dialog['entity_data_1'] = str_replace('|501|', '|503|', $f->crm->dialog['entity_data_1']);
    expect($f->linker->process($entry->id))->toMatchArray(['state' => 'preserved', 'reason' => 'prior_manual_assignment_preserved'])
        ->and($f->crm->transferCalls)->toBe(0)
        ->and(json_decode(DB::table('web_form_chat_routes')->where('entry_event_id', $entry->id)->value('proof'), true))
        ->toMatchArray(['protected_assignment' => true, 'protected_owner_id' => '74827']);
})->with(['waiting', 'linked']);

test('an original activity lead with a manual owner is preserved even when the current tracker has no lead', function () {
    $f = webChatLinkerFixture();
    $f->binding->proof['native_lead_id'] = '0';
    $f->crm->native['ASSIGNED_BY_ID'] = '29';
    $f->crm->dialog['entity_data_1'] = 'Y|DEAL|900|N|N|501|1794333600|0|0|0';
    $f->crm->dialog['entity_data_2'] = 'LEAD|0|CONTACT|710|COMPANY|0|DEAL|900';
    $before = $f->crm->bindings;
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'preserved', 'reason' => 'native_crm_assignment_preserved'])
        ->and($f->crm->transferCalls)->toBe(0)->and($f->crm->bindings)->toBe($before)
        ->and($f->crm->native['ASSIGNED_BY_ID'])->toBe('29')
        ->and(json_decode(webChatLinkerRow($f)->proof, true)['native_lead_id'])->toBe('101');
});

test('a late connector phone or subject change prevents transferring the old proof', function (string $code) {
    $f = webChatLinkerFixture();
    $f->crm->beforeCall = function ($method) use ($f, $code) {
        if ($method === 'batch') {
            $f->crm->dialog['entity_id'] = $code;
        }
    };
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'preserved', 'reason' => 'native_channel_identity_changed'])
        ->and($f->crm->transferCalls)->toBe(0);
})->with(['whatsappbyedna|1|5493510000001@2423|999', 'whatsappbyedna|1|5493510000000@9999|999']);

test('another message worker holding the chat lock prevents writes and the waiting row can resume later', function () {
    $f = webChatLinkerFixture();
    $lock = Cache::lock('web-form-chat:601', 120, 'another-message-worker');
    expect($lock->get())->toBeTrue();
    try {
        expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'waiting', 'reason' => 'chat_routing_in_progress'])
            ->and(webChatLinkerRow($f)->lease_token)->toBeNull()->and(webChatLinkerRow($f)->lease_until)->toBeNull()
            ->and($f->crm->transferCalls)->toBe(0)->and($f->crm->calls)->toBe([])
            ->and($lock->isOwnedByCurrentProcess())->toBeTrue();
    } finally {
        $lock->release();
    }
    test()->travel(61)->seconds();
    expect($f->linker->process($f->event->id)['state'])->toBe('routed')->and($f->crm->transferCalls)->toBe(1);
});

test('a proven waiting case survives session reopening while its commercial assignment finishes', function () {
    $f = webChatLinkerFixture();
    $f->crm->dealPending = true;
    expect($f->linker->process($f->event->id)['state'])->toBe('waiting')
        ->and(webChatLinkerRow($f)->proof)->not->toBeNull()->and($f->crm->transferCalls)->toBe(0);
    test()->travel(2)->minutes();
    $entry = webChatLinkerEvent();
    webChatLinkerRoute($entry, null, 'reentry');
    $f->binding->proof = webChatLinkerProof($entry, 502);
    $f->crm->sessionId = 502;
    $f->crm->dialog['entity_data_1'] = str_replace('|501|', '|502|', $f->crm->dialog['entity_data_1']);
    $f->crm->dealPending = false;
    expect($f->linker->process($entry->id)['state'])->toBe('routed')
        ->and(DB::table('web_form_chat_routes')->where('entry_event_id', $entry->id)->value('submission_id'))->toBe($f->submission)
        ->and($f->crm->transferCalls)->toBe(1);
});

test('many proven messages for one request do not make its reopening ambiguous', function () {
    $f = webChatLinkerFixture();
    expect($f->linker->process($f->event->id)['state'])->toBe('routed');
    for ($i = 1; $i <= 120; $i++) {
        $old = webChatLinkerEvent();
        DB::table('web_form_chat_routes')->insert([
            'entry_event_id' => $old->id, 'submission_id' => $f->submission,
            'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'),
            'state' => 'routed', 'link_state' => 'linked', 'transfer_state' => 'confirmed',
            'proof' => json_encode(webChatLinkerProof($old, 501 + $i), JSON_THROW_ON_ERROR),
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }
    $entry = webChatLinkerEvent();
    webChatLinkerRoute($entry, null, 'reentry');
    $f->binding->proof = webChatLinkerProof($entry, 701);
    $f->crm->sessionId = 701;
    $f->crm->dialog['owner'] = 0;
    $f->crm->dialog['entity_data_1'] = str_replace('|501|', '|701|', $f->crm->dialog['entity_data_1']);
    expect($f->linker->process($entry->id)['state'])->toBe('routed')
        ->and(DB::table('web_form_chat_routes')->where('entry_event_id', $entry->id)->value('submission_id'))->toBe($f->submission)
        ->and($f->crm->transferCalls)->toBe(2)->and(DB::table('web_form_chat_routes')->count())->toBe(122);
});

test('a newer website request on the same phone requires its reference before reusing an old case', function () {
    $f = webChatLinkerFixture();
    expect($f->linker->process($f->event->id)['state'])->toBe('routed');
    test()->travel(2)->days();
    app(WebFormReceipt::class)->register(['celular' => '3510000000', 'cuil' => '20123456786',
        '_journey_links' => ['submission_id' => (string) Str::uuid()]]);
    $entry = webChatLinkerEvent();
    webChatLinkerRoute($entry, null, 'reentry');
    $f->binding->proof = webChatLinkerProof($entry, 502);
    $f->crm->sessionId = 502;
    $f->crm->dialog['owner'] = 0;
    $f->crm->dialog['entity_data_1'] = str_replace('|501|', '|502|', $f->crm->dialog['entity_data_1']);
    $f->crm->calls = [];
    expect($f->linker->process($entry->id))->toMatchArray(['state' => 'review', 'reason' => 'reentry_new_request_requires_reference'])
        ->and($f->crm->transferCalls)->toBe(1)->and($f->crm->calls)->toBe([]);
});

test('an existing closed commercial case ends in review without recurring transfers or bindings', function (string $semantic) {
    $f = webChatLinkerFixture();
    $f->crm->deal['STAGE_SEMANTIC_ID'] = $semantic;
    $before = $f->crm->bindings;
    expect($f->linker->process($f->event->id))->toMatchArray(['state' => 'review', 'reason' => 'commercial_case_closed'])
        ->and($f->crm->transferCalls)->toBe(0)->and($f->crm->bindings)->toBe($before);
    test()->travel(61)->seconds();
    expect($f->linker->process($f->event->id))->toBe(['state' => 'not_claimed'])
        ->and($f->crm->transferCalls)->toBe(0);
})->with(['S', 'F']);

test('an eight-hour-old queued route expires before any binding or CRM operation and preserves its evidence', function () {
    $f = webChatLinkerFixture();
    $proof = json_encode(webChatLinkerProof($f->event));
    DB::table('web_form_chat_routes')->update(['created_at' => now()->subHours(8), 'proof' => $proof, 'attempts' => 400]);
    expect($f->linker->process($f->event->id)['state'])->toBe('not_claimed');
    $row = webChatLinkerRow($f);
    expect($row->state)->toBe('expired')->and($row->reason)->toBe('retry_window_expired')
        ->and($row->proof)->toBe($proof)->and($row->attempts)->toBe(400)
        ->and($f->binding->calls)->toBe(0)->and($f->crm->calls)->toBe([]);
    expect($f->linker->process($f->event->id)['state'])->toBe('not_claimed');
});

test('expiry preserves an uncertain transfer receipt in terminal review without another POST', function (string $transfer) {
    $f = webChatLinkerFixture();
    $proof = json_encode(webChatLinkerProof($f->event) + ['transfer_intent' => ['seller_id' => '90231', 'session_id' => '501'], 'transfer_acknowledged' => false]);
    DB::table('web_form_chat_routes')->update(['state' => 'unknown', 'transfer_state' => $transfer,
        'created_at' => now()->subHours(9), 'proof' => $proof]);
    $f->linker->process($f->event->id);
    expect(webChatLinkerRow($f)->state)->toBe('review')
        ->and(webChatLinkerRow($f)->reason)->toBe('transfer_unresolved_after_retry_window')
        ->and(webChatLinkerRow($f)->transfer_state)->toBe($transfer)->and(webChatLinkerRow($f)->proof)->toBe($proof)
        ->and($f->binding->calls)->toBe(0)->and($f->crm->calls)->toBe([]);
})->with(['sending', 'unknown']);

test('expiry during the final human check stops the transfer while retaining the linked activity', function () {
    $f = webChatLinkerFixture();
    DB::table('web_form_chat_routes')->update(['created_at' => now()->subHours(8)->addSeconds(5)]);
    $f->guard->beforeInspect = function ($call) {
        if ($call === 2) {
            $this->travel(10)->seconds();
        }
    };
    expect($f->linker->process($f->event->id)['state'])->toBe('expired')
        ->and($f->crm->transferCalls)->toBe(0)->and(webChatLinkerRow($f)->link_state)->toBe('linked');
});

test('expiry during an applied POST retains uncertainty and never replays the transfer', function () {
    $f = webChatLinkerFixture();
    DB::table('web_form_chat_routes')->update(['created_at' => now()->subHours(8)->addSeconds(5)]);
    $f->crm->transferMode = 'lost_after_apply';
    $f->crm->beforeCall = function ($method) {
        if ($method === 'imopenlines.operator.transfer') {
            $this->travel(10)->seconds();
        }
    };
    expect($f->linker->process($f->event->id)['state'])->toBe('review')
        ->and($f->crm->transferCalls)->toBe(1)->and(webChatLinkerRow($f)->transfer_state)->toBe('sending');
    $proof = json_decode(webChatLinkerRow($f)->proof, true);
    expect($proof['transfer_intent']['seller_id'])->toBe('90231');
    $f->linker->process($f->event->id);
    expect($f->crm->transferCalls)->toBe(1)->and($f->crm->dialog['owner'])->toBe(90231);
});

test('a positive acknowledgement arriving after expiry stays durable without further CRM calls or replay', function () {
    $f = webChatLinkerFixture();
    DB::table('web_form_chat_routes')->update(['created_at' => now()->subHours(8)->addSeconds(5)]);
    $f->crm->beforeCall = function ($method) {
        if ($method === 'imopenlines.operator.transfer') {
            $this->travel(10)->seconds();
        }
    };
    $ledger = Mockery::mock(JourneyLedger::class);
    $ledger->shouldReceive('record')->once()->withArgs(fn ($type, $data) => $type === 'whatsapp.web_chat_route'
        && $data['transfer_acknowledged'] === true && $data['state'] === 'review');
    $ledger->shouldReceive('flush')->once();
    app()->instance(JourneyLedger::class, $ledger);

    expect($f->linker->process($f->event->id)['state'])->toBe('review')
        ->and($f->crm->transferCalls)->toBe(1);
    $proof = json_decode(webChatLinkerRow($f)->proof, true);
    expect($proof['transfer_acknowledged'])->toBeTrue()
        ->and($proof['transfer_intent']['seller_id'])->toBe('90231')
        ->and($f->crm->calls[array_key_last($f->crm->calls)][0])->toBe('imopenlines.operator.transfer');
    $f->linker->process($f->event->id);
    expect($f->crm->transferCalls)->toBe(1)->and($f->crm->dialog['owner'])->toBe(90231);
});

test('waiting retries use exponential jitter without renewing the original eight-hour deadline', function () {
    $f = webChatLinkerFixture();
    $f->binding->proof = null;
    $created = webChatLinkerRow($f)->created_at;
    foreach ([[30, 60], [60, 120], [120, 240]] as $bounds) {
        $before = now();
        expect($f->linker->process($f->event->id)['state'])->toBe('waiting');
        $row = webChatLinkerRow($f);
        $delay = (int) $before->diffInSeconds(CarbonImmutable::parse($row->available_at));
        expect($delay)->toBeGreaterThanOrEqual($bounds[0])->toBeLessThanOrEqual($bounds[1])
            ->and($row->created_at)->toBe($created);
        $this->travelTo(CarbonImmutable::parse($row->available_at)->addSecond());
    }
    $this->travelTo(CarbonImmutable::parse($created)->addHours(8));
    $calls = $f->binding->calls;
    $f->linker->process($f->event->id);
    expect(webChatLinkerRow($f)->state)->toBe('expired')->and($f->binding->calls)->toBe($calls);
});

test('the next retry is capped at expiry even when its backoff is longer than the remaining window', function () {
    $f = webChatLinkerFixture();
    $f->binding->proof = null;
    DB::table('web_form_chat_routes')->update(['created_at' => now()->subHours(8)->addSeconds(10), 'attempts' => 100]);
    $f->linker->process($f->event->id);
    expect(CarbonImmutable::parse(webChatLinkerRow($f)->available_at)->toIso8601String())
        ->toBe(now()->addSeconds(10)->toIso8601String());
});

test('a proved message is reused on retry while commercial ownership is checked again', function () {
    $f = webChatLinkerFixture();
    $f->crm->dealPending = true;
    expect($f->linker->process($f->event->id)['reason'])->toBe('commercial_case_not_ready')
        ->and($f->binding->calls)->toBe(1);
    $this->travelTo(CarbonImmutable::parse(webChatLinkerRow($f)->available_at)->addSecond());
    $f->crm->dealPending = false;
    $f->crm->contact['ASSIGNED_BY_ID'] = '29';
    expect($f->linker->process($f->event->id)['reason'])->toBe('contact_responsible_preserved')
        ->and($f->binding->calls)->toBe(1)->and($f->crm->transferCalls)->toBe(0);
});
