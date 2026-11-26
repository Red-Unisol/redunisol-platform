<?php

use App\Services\EdnaBitrix;
use App\Services\EdnaRejectedChatCandidates;
use App\Services\EdnaRejectedChatClosure;
use App\Services\EdnaRejectedDealDiscovery;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-26T15:00:00Z'));
    config(['edna.enabled' => true, 'edna.intake_crm_enabled' => true, 'edna.rejection_close_enabled' => true,
        'edna.subject_id' => '2423', 'app.key' => 'base64:'.base64_encode(str_repeat('x', 32))]);
    Http::preventStrayRequests();
    Queue::fake();
});

function seedDealClosureCutover(): void
{
    DB::table('edna_intake_cutovers')->insert(['name' => EdnaRejectedDealDiscovery::CUTOVER,
        'starts_at' => now()->subHour(), 'entry_id_after' => 0]);
}

function dealClosureCandidate(string $lead, int $session, string $received, bool $beforeArrival = false): array
{
    $created = $beforeArrival ? now()->subHours(2) : now()->subMinutes(10);
    $messageId = (string) (900000 + $session);
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423', 'message_id' => $messageId,
        'status' => 'delivered', 'payload' => Crypt::encryptString(json_encode(['id' => $messageId, 'subjectId' => '2423',
            'receivedAt' => $received], JSON_THROW_ON_ERROR)), 'created_at' => $created, 'updated_at' => $created]);

    return ['lead_id' => $lead, 'proof' => ['entry_event_id' => $id, 'entry_message_id' => $messageId, 'session_id' => $session, 'chat_id' => 147259],
        'source_type' => 'edna_organic_menu', 'source_id' => (string) $id, 'source_created_at' => $created->toIso8601String()];
}

function dealClosureCrmRow(int $id, string $lead): array
{
    return ['ID' => (string) $id, 'LEAD_ID' => $lead, 'CATEGORY_ID' => '1', 'CLOSED' => 'Y', 'STAGE_ID' => 'C1:5',
        'STAGE_SEMANTIC_ID' => 'F', 'DATE_CREATE' => now()->subMinutes(5)->toIso8601String(), 'MOVED_TIME' => now()->subMinute()->toIso8601String()];
}

function dealClosureDiscoveryCrm(array $deals, array $rejectedLeads = []): EdnaBitrix
{
    return new class($deals, $rejectedLeads) extends EdnaBitrix
    {
        public array $cursors = [];

        public function __construct(public array $deals, private array $rejectedLeads) {}

        public function call(string $method, array $payload = []): mixed
        {
            if ($method === 'crm.lead.list') {
                return $this->rejectedLeads;
            }
            if ($method !== 'crm.deal.list') {
                throw new LogicException('Unexpected CRM method.');
            }
            $filter = $payload['filter'];
            $this->cursors[] = $filter['>ID'];
            $rows = array_filter($this->deals, fn ($deal) => in_array($deal['LEAD_ID'], $filter['@LEAD_ID'], true)
                && (int) $deal['ID'] > $filter['>ID']);

            return array_slice(array_values($rows), 0, 50);
        }
    };
}

test('deal polling records only the new ingress even when a lead and chat also have pre-cutover sessions', function () {
    seedDealClosureCutover();
    $recent = now()->subMinutes(10)->toIso8601String();
    $first = dealClosureCandidate('433111', 100, $recent);
    DB::table('edna_intake_cutovers')->where('name', EdnaRejectedDealDiscovery::CUTOVER)
        ->update(['entry_id_after' => $first['proof']['entry_event_id']]);
    $oldCallback = dealClosureCandidate('433111', 101, now()->subHours(2)->toIso8601String());
    $oldRow = dealClosureCandidate('433111', 102, $recent, true);
    $oldForm = dealClosureCandidate('433111', 103, $recent);
    $oldForm['source_type'] = 'web_form_chat_route';
    $oldForm['form_received_at'] = now()->subHours(2)->toIso8601String();
    $new = dealClosureCandidate('433111', 322143, $recent);
    $crm = dealClosureDiscoveryCrm([dealClosureCrmRow(1256777, '433111')]);
    app()->instance(EdnaRejectedChatCandidates::class, new class([$first, $oldCallback, $oldRow, $oldForm, $new]) extends EdnaRejectedChatCandidates
    {
        public function __construct(private array $candidates) {}

        public function discover(int $limit = 200): array
        {
            return $this->candidates;
        }
    });

    $closer = new EdnaRejectedChatClosure($crm);
    expect($closer->poll())->toBe(1)->and($closer->poll())->toBe(0);
    $receipt = DB::table('edna_rejected_chat_closures')->sole();
    expect((int) $receipt->deal_id)->toBe(1256777)->and((int) $receipt->session_id)->toBe(322143);
});

test('a second deal on the next page makes the lead ambiguous even if that deal is open', function () {
    seedDealClosureCutover();
    $candidates = $deals = [];
    for ($id = 1; $id <= 50; $id++) {
        $candidates[] = dealClosureCandidate((string) $id, $id, now()->subMinute()->toIso8601String());
        $deals[] = dealClosureCrmRow($id + 100, (string) $id);
    }
    $deals[] = array_merge(dealClosureCrmRow(151, '1'), ['CLOSED' => 'N', 'STAGE_SEMANTIC_ID' => 'P']);
    $crm = dealClosureDiscoveryCrm($deals);
    $found = (new EdnaRejectedDealDiscovery)->discover($crm, $candidates);

    expect($crm->cursors)->toBe([0, 150])->and($found)->toHaveCount(49)->not->toHaveKey(0)
        ->and($found[1])->toBe('102');
});

test('discovery requires a new terminal failed deal in a stage with a verified notice', function (array $altered) {
    seedDealClosureCutover();
    $deal = array_merge(dealClosureCrmRow(100, '7'), $altered);
    expect(EdnaRejectedDealDiscovery::eligibleDeal($deal, EdnaRejectedDealDiscovery::cutover()))->toBeFalse();
})->with([
    'deal existed before activation' => [['DATE_CREATE' => '2026-11-26T13:59:59Z']],
    'rejection predates activation' => [['MOVED_TIME' => '2026-11-26T13:59:59Z']],
    'ambiguous timestamp' => [['DATE_CREATE' => '2026-11-26']],
    'open review' => [['STAGE_ID' => 'C1:KESTRA_REVIEW']],
    'reopened' => [['CLOSED' => 'N']],
    'won' => [['STAGE_SEMANTIC_ID' => 'S']],
    'different funnel' => [['CATEGORY_ID' => '2']],
]);

test('deal closure remains dormant until an enabled healthy deployment activates it exactly once', function () {
    expect(EdnaRejectedDealDiscovery::cutover())->toBeNull();
    $old = dealClosureCandidate('433111', 100, now()->toIso8601String());
    $crm = dealClosureDiscoveryCrm([dealClosureCrmRow(1256777, '433111')]);
    expect((new EdnaRejectedDealDiscovery)->discover($crm, [$old]))->toBe([])->and($crm->cursors)->toBe([]);

    config(['edna.rejection_close_enabled' => false]);
    $this->artisan('edna:rejected-chats activate-deals')->assertSuccessful();
    expect(EdnaRejectedDealDiscovery::cutover())->toBeNull();
    config(['edna.rejection_close_enabled' => true]);
    $this->artisan('edna:rejected-chats activate-deals')->assertSuccessful();
    $first = EdnaRejectedDealDiscovery::cutover();
    expect((int) $first->entry_id_after)->toBe($old['proof']['entry_event_id'])
        ->and(CarbonImmutable::parse($first->starts_at)->equalTo(now()->addSecond()))->toBeTrue();

    $this->travel(10)->minutes();
    dealClosureCandidate('433222', 101, now()->toIso8601String());
    $this->artisan('edna:rejected-chats activate-deals')->assertSuccessful();
    expect(EdnaRejectedDealDiscovery::cutover())->toEqual($first);
    Http::assertNothingSent();
    Queue::assertNothingPushed();
});
