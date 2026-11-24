<?php

use App\Jobs\PrepareEdnaOrganicLoan;
use App\Jobs\SendEdnaFlow;
use App\Jobs\SubmitEdnaOrganicLoan;
use App\Services\AttributionJourney;
use App\Services\EdnaBenefitsRouting;
use App\Services\EdnaOrganicAttention;
use App\Services\EdnaOrganicLoan;
use App\Services\EdnaOrganicProfile;
use App\Services\WebChatContinuity;
use App\Services\WebFormReceipt;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-11T15:00:00Z'));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('l', 32)));
    config()->set('attribution.enabled', true);
    config()->set('attribution.connection', null);
    config()->set('journey.enabled', false);
    config()->set('cache.default', 'array');
    config()->set('edna', ['enabled' => true, 'organic_menu_enabled' => true, 'organic_profile_max_age_months' => 6,
        'router_enabled' => true, 'subject_id' => '2423', 'api_key' => 'loan-fixture', 'cascade_id' => '2557',
        'router_start_at' => now()->subDay()->toIso8601String(), 'router_recipients' => [],
        'intake_enabled' => true, 'intake_crm_enabled' => true, 'intake_flow_id' => '950118281197789',
        'intake_start_at' => now()->subDay()->toIso8601String(), 'intake_entry_scope' => 'sales_channel',
        'intake_sales_channel_start_at' => now()->subDay()->toIso8601String(), 'intake_recipients' => [],
        'intake_pilot_id' => 'organic-loan-test', 'intake_pilot_limit' => 'unlimited',
        'intake_processing_url' => 'https://kestra.example.test/bitrix24_whatsapp_intake/organic-fixture']);
    Cache::flush();
    Queue::fake();
    Http::preventStrayRequests();
});

class OrganicLoanProfileFake extends EdnaOrganicProfile
{
    public array $result;

    public int $calls = 0;

    public ?Closure $beforeResolve = null;

    public ?Closure $beforeStillCurrent = null;

    public function __construct()
    {
        $this->result = ['status' => 'reusable', 'reason' => 'complete_recent_profile_confirmed',
            'answer' => ['provincia' => 'cordoba', 'situacion_cordoba' => 'empleado_publico', 'banco_cordoba' => 'bancor', 'cuil' => '20301234563'],
            'identity_hash' => (new WebFormReceipt)->identityHash('20301234563'), 'lead_id' => '900', 'contact_id' => '800',
            'provenance' => ['source_kind' => 'web_form', 'source_id' => (string) Str::uuid(),
                'confirmed_at' => now()->subMonth()->toIso8601String(), 'schema' => 'whatsapp-intake-v3', 'v3_equivalent' => true]];
        (new EdnaOrganicProfile)->record('web_form', $this->result['provenance']['source_id'], '5493510000000',
            $this->result['answer'], $this->result['provenance']['confirmed_at'], '900', '800');
    }

    public function resolve(object $menu, array $proof): array
    {
        $this->calls++;
        if ($this->beforeResolve) {
            ($this->beforeResolve)($menu, $proof);
        }

        return $this->result;
    }

    public function stillCurrent(object $menu, array $answer, array $provenance, array $nativeSnapshot): bool
    {
        if ($this->beforeStillCurrent) {
            ($this->beforeStillCurrent)($menu);
        }

        return parent::stillCurrent($menu, $answer, $provenance, $nativeSnapshot);
    }
}

class OrganicLoanAttentionFake extends EdnaOrganicAttention
{
    public array $welcome = ['status' => 'ready', 'reason' => 'unattended_sales_session'];

    public array $native;

    public int $transferComparisons = 0;

    public function __construct()
    {
        $lead = ['entity' => 'lead', 'id' => '700', 'native' => true, 'owner' => '74827', 'creator' => '74827',
            'contact_id' => '800', 'lead_id' => '', 'company_id' => '', 'contact_ids' => [], 'company_ids' => [],
            'stage' => '', 'status' => 'NEW', 'stage_semantic' => '', 'status_semantic' => 'P', 'category_id' => '',
            'closed' => '', 'identity_hash' => null];
        $contact = array_replace($lead, ['entity' => 'contact', 'id' => '800', 'native' => false, 'owner' => '5737',
            'creator' => '57', 'contact_id' => '', 'status' => '', 'status_semantic' => '',
            'identity_hash' => (new WebFormReceipt)->identityHash('20301234563')]);
        $this->native = ['version' => 1, 'dialog_tuple' => ['chat_id' => '601', 'session_id' => '501',
            'source_hash' => str_repeat('a', 64), 'session_epoch' => '1794333600', 'owner' => '74827',
            'primary_entity' => 'lead', 'primary_id' => '700', 'bindings' => ['contact' => '800', 'lead' => '700']],
            'records' => [$contact, $lead]];
    }

    public function inspectWelcome(array $proof): array
    {
        return $this->welcome;
    }

    public function snapshot(array $proof): array
    {
        return $this->native + ['fingerprint' => hash('sha256', json_encode($this->native, JSON_THROW_ON_ERROR))];
    }

    public function compatible(array $before, array $after, int $targetId, bool $afterTransfer = false, bool $otherInquiry = false, ?string $verifiedContact = null): bool
    {
        $this->transferComparisons++;
        throw new RuntimeException('A credit inquiry must not apply Tincho transfer eligibility.');
    }
}

function organicLoanEvent(array $changes = []): object
{
    $message = (string) (610000 + DB::table('edna_incoming_events')->count());
    $payload = array_replace_recursive(['id' => $message, 'subjectId' => '2423', 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => now()->subMinutes(5)->toIso8601String(), 'messageContent' => ['type' => 'TEXT', 'text' => 'Hola']], $changes);
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423', 'message_id' => $message,
        'payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR)), 'status' => 'delivered',
        'created_at' => now(), 'updated_at' => now()]);

    return DB::table('edna_incoming_events')->find($id);
}

function organicLoanMenu(array $changes = []): object
{
    $request = (string) Str::uuid();
    $entry = organicLoanEvent();
    $choice = organicLoanEvent(['receivedAt' => now()->subMinute()->toIso8601String(),
        'messageContent' => ['text' => 'Quiero un préstamo', 'payload' => 'organic:'.$request.':loan']]);
    $proof = ['version' => 1, 'verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'chat_id' => '601', 'session_id' => '501', 'native_lead_id' => '700', 'entry_event_id' => $entry->id, 'entry_message_id' => $entry->message_id];
    $id = DB::table('edna_organic_menus')->insertGetId(array_replace(['request_id' => $request,
        'entry_event_id' => $entry->id, 'choice_event_id' => $choice->id, 'subject_id' => '2423', 'cascade_id' => '2557',
        'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'), 'recipient' => Crypt::encryptString('5493510000000'),
        'chat_id' => 601, 'session_id' => 501, 'proof' => json_encode($proof), 'state' => 'loan_pending',
        'send_state' => 'confirmed', 'outgoing_message_id' => '800001', 'choice' => 'loan',
        'choice_received_at' => now()->subMinute(), 'entry_received_at' => now()->subMinutes(5), 'expires_at' => now()->addHours(23),
        'created_at' => now(), 'updated_at' => now()], $changes));

    return DB::table('edna_organic_menus')->find($id);
}

function organicLoanService(?OrganicLoanProfileFake &$profile = null, ?OrganicLoanAttentionFake &$attention = null): EdnaOrganicLoan
{
    $profile = new OrganicLoanProfileFake;
    $attention = new OrganicLoanAttentionFake;

    return new EdnaOrganicLoan($profile, $attention);
}

function organicLoanAck(object $menu, array $changes = []): array
{
    return array_replace(['ok' => true, 'contract' => EdnaOrganicLoan::CONTRACT, 'case_id' => $menu->request_id,
        'write_attempted' => true, 'action' => 'queued', 'lead_id' => '700', 'contact_id' => '800'], $changes);
}

function organicLoanContinuityCutover(int $entryAfter = 0): void
{
    DB::table('edna_intake_cutovers')->insert(['name' => WebChatContinuity::NAME,
        'entry_id_after' => $entryAfter, 'starts_at' => now()->subMinutes(10)]);
}

function organicLoanCaptureWebContext(): int
{
    $input = ['celular' => '3510000000', 'cuil' => '20301234563', '_journey_links' => ['submission_id' => (string) Str::uuid()]];
    $reference = app(WebFormReceipt::class)->register($input);
    $receipt = DB::table('web_form_receipts')->find($input['_journey_links']['submission_id']);
    $anchor = organicLoanEvent(['receivedAt' => now()->toIso8601String(),
        'messageContent' => ['text' => '(solicitud: '.$reference.')']]);
    $contextId = app(WebChatContinuity::class)->captureReference($anchor, $receipt);
    expect($contextId)->toBeInt();

    return $contextId;
}

test('a newly referenced web context before loan preparation prevents profile work and any replacement Flow', function () {
    organicLoanContinuityCutover();
    $menu = organicLoanMenu();
    organicLoanCaptureWebContext();
    $service = organicLoanService($profile);
    $service->prepare($menu->id);
    expect(DB::table('edna_organic_menus')->find($menu->id))->toMatchObject([
        'state' => 'preserved', 'reason' => 'web_continuity_priority', 'flow_send_id' => null,
    ])->and($profile->calls)->toBe(0)->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Queue::assertNotPushed(SendEdnaFlow::class);
    Queue::assertNotPushed(SubmitEdnaOrganicLoan::class);
    Http::assertNothingSent();
});

test('a web reference arriving during profile resolution prevents the V3 fallback', function () {
    organicLoanContinuityCutover();
    $menu = organicLoanMenu();
    $service = organicLoanService($profile);
    $profile->result = ['status' => 'missing', 'reason' => 'complete_recent_profile_unavailable'];
    $profile->beforeResolve = fn () => organicLoanCaptureWebContext();
    $service->prepare($menu->id);
    expect(DB::table('edna_organic_menus')->find($menu->id))->toMatchObject([
        'state' => 'preserved', 'reason' => 'web_continuity_priority', 'flow_send_id' => null,
    ])->and($profile->calls)->toBe(1)->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Queue::assertNotPushed(SendEdnaFlow::class);
    Queue::assertNotPushed(SubmitEdnaOrganicLoan::class);
    Http::assertNothingSent();
});

test('a web reference arriving during the final profile reread prevents the business POST', function () {
    organicLoanContinuityCutover();
    $menu = organicLoanMenu();
    $service = organicLoanService($profile);
    $service->prepare($menu->id);
    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('submission_pending');
    $profile->beforeStillCurrent = fn () => organicLoanCaptureWebContext();
    $service->submit($menu->id);
    $service->submit($menu->id);
    expect(DB::table('edna_organic_menus')->find($menu->id))->toMatchObject([
        'state' => 'preserved', 'reason' => 'web_continuity_priority', 'flow_send_id' => null,
    ])->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Queue::assertNotPushed(SendEdnaFlow::class);
    Http::assertNothingSent();
});

test('the new routing policy belongs only to an original postcutover entry', function (bool $fresh) {
    if ($fresh) {
        organicLoanContinuityCutover();
    }
    $menu = organicLoanMenu();
    if (! $fresh) {
        organicLoanContinuityCutover((int) $menu->choice_event_id);
    }
    $service = organicLoanService();
    $service->prepare($menu->id);
    $body = null;
    Http::fake(function ($request) use ($menu, &$body) {
        $body = $request->data();

        return Http::response(organicLoanAck($menu));
    });
    $service->submit($menu->id);
    Http::assertSentCount(1);
    if ($fresh) {
        expect($body['routing_policy'] ?? null)->toBe(WebChatContinuity::NAME);
    } else {
        expect($body)->not->toHaveKey('routing_policy');
    }
    expect(DB::table('edna_flow_sends')->count())->toBe(0);
})->with([true, false]);

test('preparing a complete recent profile freezes a separate business contract without inventing a Flow', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService($profile);
    $service->prepare($menu->id);
    $prepared = DB::table('edna_organic_menus')->find($menu->id);
    $evidence = json_decode($prepared->profile_evidence, true);
    expect($prepared->state)->toBe('submission_pending')->and($prepared->case_id)->toBe($menu->request_id)
        ->and($prepared->profile_snapshot)->not->toContain('20301234563')
        ->and(json_decode(Crypt::decryptString($prepared->profile_snapshot), true))->toBe($profile->result['answer'])
        ->and($evidence['provenance'])->toBe($profile->result['provenance'])
        ->and($evidence['crm_binding']['native_lead_id'])->toBe('700')
        ->and($evidence['crm_binding']['contact_id'])->toBe('800')
        ->and($prepared->flow_send_id)->toBeNull()->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Queue::assertPushed(SubmitEdnaOrganicLoan::class, fn ($job) => $job->menuId === $menu->id);
    Http::assertNothingSent();
});

test('complete reuse sends the honest backend contract and commits intent before its only POST', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService();
    $service->prepare($menu->id);
    $body = null;
    $stateAtPost = null;
    Http::fake(function ($request) use ($menu, &$body, &$stateAtPost) {
        $stateAtPost = DB::table('edna_organic_menus')->find($menu->id)->state;
        $body = $request->data();

        return Http::response(organicLoanAck($menu));
    });
    $service->submit($menu->id);
    $service->submit($menu->id);
    Http::assertSentCount(1);
    expect($stateAtPost)->toBe('submitting')
        ->and($body)->toMatchArray(['contract' => 'organic-profile-reuse-v1', 'case_id' => $menu->request_id,
            'phone' => '5493510000000', 'dry_run' => false])->not->toHaveKeys(['flow_id', 'flow_send_id'])
        ->and($body['answer'])->toMatchArray(['cuil' => '20301234563'])
        ->and($body['crm_binding'])->toMatchArray(['native_lead_id' => '700', 'contact_id' => '800'])
        ->and($body['attribution']['wa'])->toMatchArray(['WA_ENTRY' => 'whatsapp_directo', 'WA_FLOW' => 'organic_profile_reuse'])
        ->not->toHaveKey('WA_FLOW_ID');
    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('loan_submitted')
        ->and(DB::table('edna_flow_sends')->count())->toBe(0)->and(DB::table('edna_intake_requests')->count())->toBe(0);
});

test('a stable contact owned by another employee can request credit without transferring it to Tincho', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService($profile, $attention);
    $attention->native['records'][0]['owner'] = '88';
    $snapshot = $attention->snapshot([]);
    expect((new EdnaOrganicAttention)->canTransfer($snapshot, 5737))->toBeFalse();
    $service->prepare($menu->id);
    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('submission_pending');
    Http::fake(['kestra.example.test/*' => Http::response(organicLoanAck($menu))]);
    $service->submit($menu->id);
    Http::assertSentCount(1);
    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('loan_submitted')
        ->and($attention->transferComparisons)->toBe(0)->and($attention->native['records'][0]['owner'])->toBe('88')
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
});

test('enqueue observes the lease due date and recent scheduling receipt', function (string $block) {
    $menu = organicLoanMenu(match ($block) {
        'lease' => ['lease_token' => (string) Str::uuid(), 'lease_until' => now()->addMinute()],
        'due' => ['available_at' => now()->addMinute()],
        'enqueued' => ['enqueued_at' => now()],
    });
    $service = organicLoanService();
    expect($service->enqueue($menu->id))->toBeFalse();
    Queue::assertNothingPushed();
})->with(['lease', 'due', 'enqueued']);

test('one preparation owns the state transition and a second preparation cannot freeze another case', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService($profile);
    expect($service->enqueue($menu->id))->toBeTrue()->and($service->enqueue($menu->id))->toBeFalse();
    Queue::assertPushed(PrepareEdnaOrganicLoan::class, 1);
    $service->prepare($menu->id);
    $service->prepare($menu->id);
    expect($profile->calls)->toBe(1);
    Queue::assertPushed(SubmitEdnaOrganicLoan::class, 1);
});

test('an active preparation lease prevents another worker from resolving or preparing the profile', function () {
    $menu = organicLoanMenu(['lease_token' => (string) Str::uuid(), 'lease_until' => now()->addMinute()]);
    $service = organicLoanService($profile);
    $service->prepare($menu->id);
    expect($profile->calls)->toBe(0)->and(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('loan_pending');
    Queue::assertNothingPushed();
    Http::assertNothingSent();
});

test('a superseded preparation lease cannot overwrite the newer decision or schedule a submission', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService($profile);
    $profile->beforeResolve = function () use ($menu) {
        DB::table('edna_organic_menus')->where('id', $menu->id)->update(['lease_token' => (string) Str::uuid(),
            'lease_until' => now()->addMinutes(2), 'state' => 'preserved', 'reason' => 'newer_owner_preserved']);
    };
    try {
        $service->prepare($menu->id);
    } catch (RuntimeException $error) {
        expect($error->getMessage())->toBe('Organic inquiry lease superseded.');
    }
    $current = DB::table('edna_organic_menus')->find($menu->id);
    expect($current->state)->toBe('preserved')->and($current->reason)->toBe('newer_owner_preserved')
        ->and($current->profile_snapshot)->toBeNull()->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Queue::assertNotPushed(SubmitEdnaOrganicLoan::class);
    Http::assertNothingSent();
});

test('another chat routing lock defers submission without a POST or fallback', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService();
    $service->prepare($menu->id);
    $lock = Cache::lock('web-form-chat:601', 120, 'another-process');
    expect($lock->get())->toBeTrue();
    try {
        $service->submit($menu->id);
        $current = DB::table('edna_organic_menus')->find($menu->id);
        expect($current->state)->toBe('submission_pending')->and($current->reason)->toBe('chat_routing_in_progress')
            ->and(DB::table('edna_flow_sends')->count())->toBe(0);
        Http::assertNothingSent();
    } finally {
        $lock->release();
    }
});

test('missing incomplete assistance stale or ambiguous profiles schedule the genuine V3 fallback', function (string $reason) {
    $menu = organicLoanMenu();
    $service = organicLoanService($profile);
    $profile->result = ['status' => $reason === 'profile_phone_has_multiple_identities' ? 'ambiguous' : 'missing', 'reason' => $reason];
    $service->prepare($menu->id);
    $updated = DB::table('edna_organic_menus')->find($menu->id);
    $send = DB::table('edna_flow_sends')->first();
    expect($updated->state)->toBe('flow_scheduled')->and($send)->not->toBeNull()
        ->and($send->flow_id)->toBe('950118281197789')->and($send->state)->toBe('pending')
        ->and($updated->profile_snapshot)->toBeNull()->and(DB::table('edna_flow_sends')->count())->toBe(1);
    Queue::assertPushed(SendEdnaFlow::class, 1);
    Queue::assertNotPushed(SubmitEdnaOrganicLoan::class);
    Http::assertNothingSent();
})->with(['complete_recent_profile_unavailable', 'profile_assistance_only', 'profile_stale', 'profile_phone_has_multiple_identities']);

test('a direct authenticated contact loan produces one genuine v3 or reuses an existing profile without a phantom greeting', function (bool $reuse) {
    config(['edna.sales_inbox_enabled' => true]);
    $entry = organicLoanEvent(['messageContent' => ['type' => 'TEXT', 'text' => 'Quiero solicitar un préstamo']]);
    $proof = ['version' => 1, 'verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'chat_id' => '601', 'session_id' => '501', 'activity_id' => '777', 'message_id' => '888',
        'entry_event_id' => $entry->id, 'entry_message_id' => $entry->message_id, 'native_lead_id' => null];
    $proof['choice_proof'] = $proof;
    $proof['direct_loan_contact'] = '800';
    $menu = organicLoanMenu(['entry_event_id' => $entry->id, 'choice_event_id' => $entry->id, 'send_state' => 'not_needed',
        'outgoing_message_id' => null, 'proof' => json_encode($proof)]);
    $service = organicLoanService($profile);
    if (!$reuse) {
        $profile->result = ['status' => 'missing', 'reason' => 'complete_recent_profile_unavailable'];
    }
    $service->prepare($menu->id);
    $service->prepare($menu->id);
    $row = DB::table('edna_organic_menus')->find($menu->id);
    expect($row->state)->toBe($reuse ? 'submission_pending' : 'flow_scheduled')->and($row->send_state)->toBe('not_needed')
        ->and(DB::table('edna_flow_sends')->count())->toBe($reuse ? 0 : 1);
    if (!$reuse) {
        $send = DB::table('edna_flow_sends')->first();
        $worker = new SendEdnaFlow($send->id);
        $context = new ReflectionMethod($worker, 'organicContext');
        expect($context->invoke($worker, $send))->toMatchArray(['menu_id' => $menu->id]);
        $proof['choice_proof']['message_id'] = '999';
        DB::table('edna_organic_menus')->where('id', $menu->id)->update(['proof' => json_encode($proof)]);
        expect($context->invoke($worker, $send))->toBeFalse();
    }
})->with([[true], [false]]);

test('an unavailable profile source retries local preparation without creating a replacement declaration', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService($profile);
    $profile->result = ['status' => 'pending', 'reason' => 'profile_source_unavailable'];
    $service->prepare($menu->id);
    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('loan_pending')->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Http::assertNothingSent();
});

test('a timeout after submission intent cannot retry the POST or send a V3 fallback', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService();
    $service->prepare($menu->id);
    $posts = 0;
    Http::fake(function () use (&$posts) {
        $posts++;
        throw new ConnectionException('Private transport body must not enter state reasons');
    });
    $service->submit($menu->id);
    $service->submit($menu->id);
    $this->travel(3)->minutes();
    expect($service->poll())->toBe(0)->and($posts)->toBe(1);
    $updated = DB::table('edna_organic_menus')->find($menu->id);
    expect($updated->state)->toBe('loan_unknown')->and($updated->reason)->toBe('organic_reuse_result_uncertain')
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
});

test('a missing or mismatched business acknowledgement remains unknown without fallback', function (array $changes) {
    $menu = organicLoanMenu();
    $service = organicLoanService();
    $service->prepare($menu->id);
    Http::fake(['kestra.example.test/*' => Http::response(organicLoanAck($menu, $changes))]);
    $service->submit($menu->id);
    $service->submit($menu->id);
    Http::assertSentCount(1);
    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('loan_unknown')
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
})->with([[['ok' => false]], [['contract' => 'website-intake-v1']], [['case_id' => 'unrelated-case']], [['write_attempted' => null]]]);

test('an exactly acknowledged provisional case creates a local watch only for fresh entries and never resubmits', function (string $condition) {
    organicLoanContinuityCutover();
    $menu = organicLoanMenu();
    DB::table('edna_intake_cutovers')->updateOrInsert(['name' => 'organic-seller-wait-v1'],
        ['entry_id_after' => $condition === 'old' ? $menu->entry_event_id : 0, 'starts_at' => now()->subMinutes(10)]);
    $service = organicLoanService();
    $service->prepare($menu->id);
    Http::fake(['kestra.example.test/*' => Http::response(organicLoanAck($menu,
        ['action' => 'awaiting_seller', 'reason' => 'provisional_commercial_queue', 'deal_id' => '110',
            'seller_id' => '', 'initial_stage' => 'C1:KESTRA_QUEUE', 'contact_deal_activity' => false, 'write_attempted' => $condition === 'wrote']))]);
    $service->submit($menu->id);
    $service->submit($menu->id);
    $updated = DB::table('edna_organic_menus')->find($menu->id);
    expect($updated->state)->toBe($condition === 'fresh' ? 'seller_wait' : 'review')
        ->and($updated->seller_id)->toBeNull()->and(DB::table('edna_flow_sends')->count())->toBe(0);
    if ($condition === 'fresh') {
        expect($updated->deal_id)->toBe('110')->and(json_decode($updated->profile_evidence, true)['waiting_case']['contact_id'])->toBe('800');
    }
    Http::assertSentCount(1);
})->with(['fresh', 'old', 'wrote']);

test('an assigned commercial case becomes route pending with the acknowledged target and deal', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService();
    $service->prepare($menu->id);
    Http::fake(['kestra.example.test/*' => Http::response(organicLoanAck($menu,
        ['action' => 'assigned_case', 'write_attempted' => false, 'deal_id' => '120001', 'seller_id' => '71159']))]);
    $service->submit($menu->id);
    $updated = DB::table('edna_organic_menus')->find($menu->id);
    expect($updated->state)->toBe('route_pending')->and($updated->deal_id)->toBe('120001')->and($updated->seller_id)->toBe('71159')
        ->and($updated->flow_send_id)->toBeNull()->and(DB::table('edna_flow_sends')->count())->toBe(0);
});

test('only an explicit backend no-write stale-profile result can start a fresh V3 after a POST', function (bool $wrote) {
    $menu = organicLoanMenu();
    $service = organicLoanService();
    $service->prepare($menu->id);
    Http::fake(['kestra.example.test/*' => Http::response(organicLoanAck($menu, ['action' => 'reused_not_valid', 'write_attempted' => $wrote]))]);
    $service->submit($menu->id);
    expect(DB::table('edna_flow_sends')->count())->toBe($wrote ? 0 : 1)
        ->and(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe($wrote ? 'review' : 'flow_scheduled');
})->with([false, true]);

test('data becoming stale or identifying someone else after capture cannot be submitted from its frozen copy', function (string $change) {
    $menu = organicLoanMenu();
    $service = organicLoanService($profile);
    if ($change === 'stale') {
        $date = now()->subMonthsNoOverflow(6)->addSeconds(30);
        $profile->result['provenance']['confirmed_at'] = $date->toIso8601String();
        DB::table('edna_customer_profiles')->where('source_id', $profile->result['provenance']['source_id'])->update(['confirmed_at' => $date]);
    }
    $service->prepare($menu->id);
    if ($change === 'stale') {
        $this->travel(1)->minutes();
    } else {
        $answer = $profile->result['answer'];
        $answer['cuil'] = '20987654326';
        DB::table('edna_customer_profiles')->where('source_id', $profile->result['provenance']['source_id'])->update([
            'identity_hash' => (new WebFormReceipt)->identityHash($answer['cuil']),
            'answer' => Crypt::encryptString(json_encode($answer)),
        ]);
    }
    Http::fake(['kestra.example.test/*' => Http::response(organicLoanAck($menu))]);
    $service->submit($menu->id);
    Http::assertNothingSent();
    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->not->toBeIn(['loan_submitted', 'loan_unknown', 'submitting']);
})->with(['stale', 'identity']);

test('an expired menu capture cannot submit a stored profile', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService();
    $service->prepare($menu->id);
    $this->travel(24)->hours();
    Http::fake(['kestra.example.test/*' => Http::response(organicLoanAck($menu))]);
    $service->submit($menu->id);
    Http::assertNothingSent();
    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->not->toBe('loan_submitted');
});

test('changing the authenticated entry identity after preparation blocks the business POST', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService();
    $service->prepare($menu->id);
    $entry = DB::table('edna_incoming_events')->find($menu->entry_event_id);
    $payload = json_decode(Crypt::decryptString($entry->payload), true);
    $payload['subscriber']['identifier'] = '5493519999999';
    DB::table('edna_incoming_events')->where('id', $entry->id)->update(['payload' => Crypt::encryptString(json_encode($payload))]);
    $service->submit($menu->id);
    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('review');
    Http::assertNothingSent();
});

test('benefits continuity prevents profile reuse and a fallback V3', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService($profile);
    $benefits = Mockery::mock(EdnaBenefitsRouting::class);
    $benefits->shouldReceive('check')->once()->andReturn(['state' => 'preserved', 'reason' => 'benefits_routing']);
    app()->instance(EdnaBenefitsRouting::class, $benefits);

    $service->prepare($menu->id);

    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('preserved')
        ->and($profile->calls)->toBe(0)->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Queue::assertNotPushed(SendEdnaFlow::class);
    Http::assertNothingSent();
});

test('benefits identified after preparation prevents the business POST', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService();
    $service->prepare($menu->id);
    $benefits = Mockery::mock(EdnaBenefitsRouting::class);
    $benefits->shouldReceive('check')->once()->andReturn(['state' => 'preserved', 'reason' => 'benefits_routing']);
    app()->instance(EdnaBenefitsRouting::class, $benefits);

    $service->submit($menu->id);
    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('preserved')
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Http::assertNothingSent();
});

test('a delayed benefits decision after a no-write acknowledgement resumes fallback without another business POST', function () {
    $menu = organicLoanMenu();
    $service = organicLoanService();
    $service->prepare($menu->id);
    $benefits = Mockery::mock(EdnaBenefitsRouting::class);
    $benefits->shouldReceive('check')->times(3)->andReturn(null, null,
        ['state' => 'waiting', 'reason' => 'benefits_case_reads_pending']);
    app()->instance(EdnaBenefitsRouting::class, $benefits);
    Http::fake(['kestra.example.test/*' => Http::response(organicLoanAck($menu,
        ['action' => 'reused_not_valid', 'write_attempted' => false]))]);

    $service->submit($menu->id);
    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('fallback_pending');
    $service->submit($menu->id);
    Http::assertSentCount(1);
    $ready = Mockery::mock(EdnaBenefitsRouting::class);
    $ready->shouldReceive('check')->once()->andReturn(null);
    app()->instance(EdnaBenefitsRouting::class, $ready);
    $this->travel(2)->minutes();
    $service->prepare($menu->id);

    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('flow_scheduled')
        ->and(DB::table('edna_flow_sends')->count())->toBe(1);
    Http::assertSentCount(1);
});

test('reusable data without a native CRM person asks the customer for a fresh declaration', function () {
    $menu = organicLoanMenu();
    $proof = json_decode($menu->proof, true, 16, JSON_THROW_ON_ERROR);
    $proof['native_lead_id'] = null;
    DB::table('edna_organic_menus')->where('id', $menu->id)->update(['proof' => json_encode($proof, JSON_THROW_ON_ERROR)]);
    $service = organicLoanService($profile, $attention);
    unset($attention->native['dialog_tuple']['bindings']['contact']);
    $service->prepare($menu->id);
    expect(DB::table('edna_organic_menus')->find($menu->id)->state)->toBe('flow_scheduled')
        ->and(DB::table('edna_flow_sends')->count())->toBe(1);
    Http::assertNothingSent();
});
