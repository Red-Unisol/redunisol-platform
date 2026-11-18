<?php

use App\Services\EdnaRejectedChatCandidates;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 18)->setTime(12, 0));
    config()->set('edna.subject_id', '2423');
    Http::preventStrayRequests();
    Queue::fake();
});

function rejectedCandidateEntry($created = null, string $subject = '2423'): object
{
    $created ??= now()->subHour();
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => $subject,
        'message_id' => (string) random_int(1000000000, 2000000000), 'status' => 'delivered',
        'created_at' => $created, 'updated_at' => $created]);

    return DB::table('edna_incoming_events')->find($id);
}

function rejectedCandidateProof(object $entry, string $chat = '145661', string $session = '318043'): array
{
    return ['version' => 1, 'source' => 'bitrix_openline_session', 'verified' => true,
        'evidence' => 'external_message_id', 'entry_event_id' => (int) $entry->id,
        'entry_message_id' => $entry->message_id, 'chat_id' => $chat, 'session_id' => $session,
        'message_id' => '7083000', 'activity_id' => '713509', 'native_lead_id' => '428407'];
}

function rejectedCandidateBinding(object $entry, array $proof, ?string $lead = '428407', $created = null): int
{
    $created ??= $entry->created_at;
    $case = (string) Str::uuid();
    $send = DB::table('edna_flow_sends')->insertGetId(['request_id' => $case, 'entry_event_id' => $entry->id,
        'scope' => hash('sha256', $case), 'subject_id' => $entry->subject_id, 'cascade_id' => '2557',
        'flow_id' => '950118281197789', 'state' => 'completed', 'entry_received_at' => $created,
        'created_at' => $created, 'updated_at' => $created]);
    DB::table('edna_intake_bindings')->insert(['flow_send_id' => $send, 'case_id' => $case,
        'entry_event_id' => $entry->id, 'state' => 'verified', 'lead_id' => $lead,
        'proof' => json_encode($proof), 'verified_at' => $created, 'created_at' => $created, 'updated_at' => $created]);

    return $send;
}

function rejectedCandidateRequest(int $send, string $lead, string $state = 'synced'): int
{
    return DB::table('edna_intake_requests')->insertGetId(['flow_send_id' => $send,
        'response_event_id' => 10000 + $send, 'received_at' => now()->subMinutes(30), 'state' => $state,
        'reason' => 'employment_status_not_eligible', 'lead_id' => $lead,
        'created_at' => now()->subMinutes(30), 'updated_at' => now()->subMinutes(30)]);
}

test('a recent original native lead is discoverable without any external call or write', function () {
    $entry = rejectedCandidateEntry();
    $proof = rejectedCandidateProof($entry);
    rejectedCandidateBinding($entry, $proof);
    $before = DB::table('edna_intake_bindings')->get()->toArray();

    $found = (new EdnaRejectedChatCandidates)->discover();

    expect($found)->toHaveCount(1)
        ->and($found[0])->toMatchArray(['lead_id' => '428407', 'proof' => $proof,
            'source_type' => 'edna_intake_binding', 'source_id' => '1'])
        ->and($found[0]['source_created_at'])->toBeString()
        ->and(DB::table('edna_intake_bindings')->get()->toArray())->toEqual($before);
    Http::assertNothingSent();
    Queue::assertNothingPushed();
});

test('a processed CONTACT native request supplies its resulting lead without rewriting the proof', function () {
    $entry = rejectedCandidateEntry();
    $proof = rejectedCandidateProof($entry);
    $proof['version'] = 2;
    $proof['native_lead_id'] = null;
    $proof['contact_id'] = '205259';
    $send = rejectedCandidateBinding($entry, $proof, null);
    $request = rejectedCandidateRequest($send, '428617');

    $found = (new EdnaRejectedChatCandidates)->discover();

    expect($found)->toHaveCount(1)
        ->and($found[0])->toMatchArray(['lead_id' => '428617', 'source_type' => 'edna_intake_request',
            'source_id' => (string) $request, 'proof' => $proof])
        ->and($found[0]['proof']['native_lead_id'])->toBeNull()
        ->and($found[0]['proof'])->not->toHaveKey('lead_id');
});

test('two inquiries on the same contact retain their distinct sessions and resulting leads', function () {
    foreach (['318129' => '428617', '318130' => '428618'] as $session => $lead) {
        $entry = rejectedCandidateEntry();
        $proof = rejectedCandidateProof($entry, '121095', (string) $session);
        $proof['version'] = 2;
        $proof['native_lead_id'] = null;
        $proof['contact_id'] = '205259';
        rejectedCandidateRequest(rejectedCandidateBinding($entry, $proof, null), $lead);
    }

    $found = (new EdnaRejectedChatCandidates)->discover();
    expect($found)->toHaveCount(2)
        ->and(array_column($found, 'lead_id'))->toContain('428617', '428618')
        ->and(array_column(array_column($found, 'proof'), 'session_id'))->toContain('318129', '318130');
});

test('waiting or unverified bindings never fabricate proof or dispatch recovery work', function () {
    $entry = rejectedCandidateEntry();
    $send = rejectedCandidateBinding($entry, rejectedCandidateProof($entry));
    rejectedCandidateRequest($send, '428407');
    DB::table('edna_intake_bindings')->update(['state' => 'waiting_source_bound', 'proof' => null]);

    expect((new EdnaRejectedChatCandidates)->discover())->toBe([]);
    expect((new EdnaRejectedChatCandidates)->discover())->toBe([]);
    Http::assertNothingSent();
    Queue::assertNothingPushed();
    expect(DB::table('edna_intake_bindings')->first()->state)->toBe('waiting_source_bound');
});

test('invalid proofs are omitted even if their local state says verified', function (string $kind) {
    $entry = rejectedCandidateEntry();
    $proof = rejectedCandidateProof($entry);
    match ($kind) {
        'unverified' => $proof['verified'] = false,
        'external-message' => $proof['entry_message_id'] = '999999999',
        'entry' => $proof['entry_event_id'] = 999999,
        'session' => $proof['session_id'] = '0',
        'source' => $proof['source'] = 'phone_match',
        'version' => $proof['version'] = '1',
        'unknown-version' => $proof['version'] = 3,
        'null-version' => $proof['version'] = null,
        'conflicting-lead' => $proof['native_lead_id'] = '999999',
    };
    rejectedCandidateBinding($entry, $proof);

    expect((new EdnaRejectedChatCandidates)->discover())->toBe([]);
})->with(['unverified', 'external-message', 'entry', 'session', 'source', 'version', 'unknown-version', 'null-version', 'conflicting-lead']);

test('a binding must belong to the exact flow case and entry', function (string $kind) {
    $entry = rejectedCandidateEntry();
    rejectedCandidateBinding($entry, rejectedCandidateProof($entry));
    DB::table('edna_intake_bindings')->update($kind === 'case'
        ? ['case_id' => (string) Str::uuid()] : ['entry_event_id' => $entry->id + 100]);

    expect((new EdnaRejectedChatCandidates)->discover())->toBe([]);
})->with(['case', 'entry']);

test('sources older than 24 hours and future or foreign channel sources are omitted', function (string $kind) {
    $created = match ($kind) {
        'old' => now()->subDay()->subSecond(),
        'future' => now()->addSecond(),
        default => now()->subHour(),
    };
    $entry = rejectedCandidateEntry($created, $kind === 'channel' ? '9999' : '2423');
    rejectedCandidateBinding($entry, rejectedCandidateProof($entry));

    expect((new EdnaRejectedChatCandidates)->discover())->toBe([]);
})->with(['old', 'future', 'channel']);

test('only synced requests can contribute a resulting CONTACT lead', function (string $state) {
    $entry = rejectedCandidateEntry();
    $proof = rejectedCandidateProof($entry);
    $proof['version'] = 2;
    $proof['native_lead_id'] = null;
    $proof['contact_id'] = '205259';
    rejectedCandidateRequest(rejectedCandidateBinding($entry, $proof, null), '428617', $state);

    expect((new EdnaRejectedChatCandidates)->discover())->toBe([]);
})->with(['pending', 'processing', 'review', 'unknown']);

function rejectedCandidateMenu(object $entry, array $proof, string $lead = '428407', string $state = 'loan_submitted'): void
{
    DB::table('edna_organic_menus')->insert(['request_id' => (string) Str::uuid(), 'entry_event_id' => $entry->id,
        'subject_id' => $entry->subject_id, 'cascade_id' => '2557', 'phone_hash' => hash('sha256', 'unused'),
        'recipient' => 'unused-encrypted-fixture', 'chat_id' => $proof['chat_id'], 'session_id' => $proof['session_id'],
        'proof' => json_encode($proof), 'state' => $state, 'choice' => 'loan',
        'profile_evidence' => json_encode(['result' => ['action' => 'rejected', 'lead_id' => $lead]]),
        'entry_received_at' => $entry->created_at, 'expires_at' => now()->addDay(),
        'created_at' => $entry->created_at, 'updated_at' => $entry->created_at]);
}

test('a submitted organic reuse retains the original proof and the ACK result lead', function () {
    $entry = rejectedCandidateEntry();
    $proof = rejectedCandidateProof($entry, '121095', '318129');
    $proof['native_lead_id'] = null;
    rejectedCandidateMenu($entry, $proof, '428617');

    $found = (new EdnaRejectedChatCandidates)->discover();
    expect($found)->toHaveCount(1)->and($found[0])->toMatchArray(['lead_id' => '428617',
        'source_type' => 'edna_organic_menu', 'proof' => $proof]);
});

test('an organic result from a different session or a menu not submitted cannot become a candidate', function (string $kind) {
    $entry = rejectedCandidateEntry();
    rejectedCandidateMenu($entry, rejectedCandidateProof($entry), '428407', $kind === 'pending' ? 'selected' : 'loan_submitted');
    if ($kind === 'session') {
        DB::table('edna_organic_menus')->update(['session_id' => '999999']);
    }

    expect((new EdnaRejectedChatCandidates)->discover())->toBe([]);
})->with(['pending', 'session']);

test('web routes use the exact submission receipt and proof never a shared phone', function () {
    $entry = rejectedCandidateEntry();
    $proof = rejectedCandidateProof($entry);
    $receipt = (string) Str::uuid();
    DB::table('web_form_receipts')->insert(['id' => $receipt, 'state' => 'synced', 'lead_id' => '428407',
        'received_at' => $entry->created_at, 'expires_at' => now()->addDay(),
        'created_at' => $entry->created_at, 'updated_at' => $entry->created_at]);
    DB::table('web_form_chat_routes')->insert(['entry_event_id' => $entry->id, 'submission_id' => $receipt,
        'state' => 'review', 'reason' => 'web_case_rejected', 'proof' => json_encode($proof),
        'created_at' => $entry->created_at, 'updated_at' => $entry->created_at]);
    $found = (new EdnaRejectedChatCandidates)->discover();
    expect($found)->toHaveCount(1)->and($found[0])->toMatchArray(['source_type' => 'web_form_chat_route', 'lead_id' => '428407']);

    DB::table('web_form_chat_routes')->update(['submission_id' => (string) Str::uuid()]);
    expect((new EdnaRejectedChatCandidates)->discover())->toBe([]);
});

test('duplicate sources collapse by chat session and lead while a reopened session remains distinct', function () {
    $entry = rejectedCandidateEntry();
    $proof = rejectedCandidateProof($entry);
    rejectedCandidateRequest(rejectedCandidateBinding($entry, $proof), '428407');
    rejectedCandidateMenu($entry, $proof);
    $next = rejectedCandidateEntry(now()->subMinutes(10));
    rejectedCandidateMenu($next, rejectedCandidateProof($next, '145661', '318999'));

    $found = (new EdnaRejectedChatCandidates)->discover();
    expect($found)->toHaveCount(2)
        ->and(array_column(array_column($found, 'proof'), 'session_id'))->toContain('318043', '318999');
    expect((new EdnaRejectedChatCandidates)->discover(1))->toHaveCount(1)
        ->and((new EdnaRejectedChatCandidates)->discover(0))->toBe([]);
});

test('legacy verified proofs without a version remain usable without inventing a version', function (string $source) {
    $entry = rejectedCandidateEntry();
    $proof = rejectedCandidateProof($entry);
    unset($proof['version']);
    if ($source === 'binding') {
        rejectedCandidateBinding($entry, $proof);
    } else {
        $receipt = (string) Str::uuid();
        DB::table('web_form_receipts')->insert(['id' => $receipt, 'state' => 'synced', 'lead_id' => '428407',
            'received_at' => $entry->created_at, 'expires_at' => now()->addDay(),
            'created_at' => $entry->created_at, 'updated_at' => $entry->created_at]);
        DB::table('web_form_chat_routes')->insert(['entry_event_id' => $entry->id, 'submission_id' => $receipt,
            'state' => 'review', 'reason' => 'web_case_rejected', 'proof' => json_encode($proof),
            'created_at' => $entry->created_at, 'updated_at' => $entry->created_at]);
    }

    $found = (new EdnaRejectedChatCandidates)->discover();
    expect($found)->toHaveCount(1)->and($found[0]['lead_id'])->toBe('428407')
        ->and($found[0]['proof'])->toEqual($proof)->not->toHaveKey('version');
    $proof['session_id'] = '0';
    DB::table($source === 'binding' ? 'edna_intake_bindings' : 'web_form_chat_routes')
        ->update(['proof' => json_encode($proof)]);
    expect((new EdnaRejectedChatCandidates)->discover())->toBe([]);
    Http::assertNothingSent();
    Queue::assertNothingPushed();
})->with(['binding', 'web-route']);
