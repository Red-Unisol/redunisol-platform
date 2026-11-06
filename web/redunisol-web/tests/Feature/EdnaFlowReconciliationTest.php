<?php

use App\Jobs\ReconcileEdnaFlow;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

beforeEach(function () {
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('r', 32)));
    config()->set('edna.api_key', 'reconciliation-test-key');
    Http::swap(new Factory);
    Http::preventStrayRequests();
});

function reconciliationSend(array $overrides = []): object
{
    $id = DB::table('edna_flow_sends')->insertGetId(array_replace([
        'request_id' => '4230b353-4d89-4aad-8c36-134e67993005',
        'entry_event_id' => 1,
        'scope' => str_repeat('a', 64),
        'subject_id' => '2423',
        'cascade_id' => '2557',
        'flow_id' => '950118281197789',
        'recipient' => Crypt::encryptString('5493510000000'),
        'state' => 'unknown',
        'reason' => 'history_exhausted',
        'entry_received_at' => now()->subMinute(),
        'send_started_at' => now()->subSeconds(30),
        'created_at' => now()->subMinute(),
        'updated_at' => now()->subMinute(),
    ], $overrides));

    return DB::table('edna_flow_sends')->find($id);
}

function reconciliationMessage(object $send, array $overrides = []): array
{
    return array_replace([
        'messageId' => '9001',
        'comment' => $send->request_id,
        'direction' => 'OUT',
        'channelType' => 'WHATSAPP',
        'subjectId' => 2423,
        'cascadeId' => 2557,
        'address' => '5493510000000',
        'deliveryStatus' => 'FAILED',
        'content' => '{}',
    ], $overrides);
}

function reconciliationHistory(array $messages, bool $hasNext = false): void
{
    Http::fake(['app.edna.io/api/messages/history' => Http::response([
        'content' => $messages, 'hasNext' => $hasNext,
    ])]);
}

function expectReconciliationUncertain(object $send): void
{
    expect(fn () => (new ReconcileEdnaFlow($send->id))->handle())
        ->toThrow(RuntimeException::class, 'Edna Flow history unconfirmed; inspect the send ID.');
    $actual = DB::table('edna_flow_sends')->find($send->id);
    expect($actual->state)->toBe($send->state)
        ->and($actual->reason)->toBe($send->reason)
        ->and($actual->outgoing_message_id)->toBe($send->outgoing_message_id);
    Http::assertSentCount(1);
}

test('terminal provider failures close an identified send without requiring Flow content', function (string $status, mixed $content) {
    $send = reconciliationSend();
    reconciliationHistory([reconciliationMessage($send, ['deliveryStatus' => $status, 'content' => $content])]);

    (new ReconcileEdnaFlow($send->id))->handle();
    $actual = DB::table('edna_flow_sends')->find($send->id);
    expect($actual->state)->toBe('rejected')
        ->and($actual->reason)->toBe('outgoing_not_delivered')
        ->and($actual->outgoing_message_id)->toBe('9001');
    Http::assertSentCount(1);
    Http::assertSent(fn ($request) => str_ends_with($request->url(), '/messages/history'));
})->with([
    ['FAILED', '{}'], ['FAILED', '[]'], ['FAILED', 'not a JSON body'], ['FAILED', null],
    ['INVALID', null], ['UNDELIVERED', null], ['CANCELLED', null],
]);

test('a failed status cannot bypass send identity checks', function (array $mismatch) {
    $send = reconciliationSend();
    reconciliationHistory([reconciliationMessage($send, $mismatch)]);

    expectReconciliationUncertain($send);
})->with([
    'different request' => [['comment' => 'another-request']],
    'different direction' => [['direction' => 'IN']],
    'different channel' => [['channelType' => 'SMS']],
    'different subject' => [['subjectId' => 9999]],
    'different cascade' => [['cascadeId' => 9999]],
    'different recipient' => [['address' => '5493519999999']],
    'missing message ID' => [['messageId' => null]],
    'invalid message ID' => [['messageId' => 'not-an-id']],
]);

test('a recorded outgoing message ID must match even when the provider reports failure', function () {
    $send = reconciliationSend(['outgoing_message_id' => '8000']);
    reconciliationHistory([reconciliationMessage($send)]);

    expectReconciliationUncertain($send);
});

test('multiple or conflicting messages for one request remain uncertain', function (array $second) {
    $send = reconciliationSend();
    reconciliationHistory([reconciliationMessage($send), reconciliationMessage($send, $second)]);

    expectReconciliationUncertain($send);
})->with([
    'distinct message IDs' => [['messageId' => '9002']],
    'one message with conflicting statuses' => [['deliveryStatus' => 'SENT']],
]);

test('incomplete history cannot close a provider failure', function () {
    $send = reconciliationSend();
    reconciliationHistory([reconciliationMessage($send)], true);

    expectReconciliationUncertain($send);
});

test('positive delivery statuses still require the exact recorded Flow', function (string $status, mixed $content) {
    $send = reconciliationSend();
    reconciliationHistory([reconciliationMessage($send, ['deliveryStatus' => $status, 'content' => $content])]);

    expectReconciliationUncertain($send);
})->with([
    ['SENT', null], ['DELIVERED', '{}'], ['READ', 'not JSON'],
    ['READ', ['type' => 'TEXT', 'flowId' => '950118281197789']],
    ['READ', ['type' => 'FLOW', 'flowId' => '123']],
]);

test('positive delivery with exact Flow content confirms the send', function (string $status, bool $encoded) {
    $send = reconciliationSend(['outgoing_message_id' => '9001']);
    $content = ['type' => 'FLOW', 'flowId' => '950118281197789'];
    reconciliationHistory([reconciliationMessage($send, [
        'deliveryStatus' => $status, 'content' => $encoded ? json_encode($content) : $content,
    ])]);

    (new ReconcileEdnaFlow($send->id))->handle();
    $actual = DB::table('edna_flow_sends')->find($send->id);
    expect($actual->state)->toBe('confirmed')
        ->and($actual->reason)->toBeNull()
        ->and($actual->outgoing_message_id)->toBe('9001');
    Http::assertSentCount(1);
})->with([['SENT', true], ['DELIVERED', false], ['READ', true]]);

test('nonterminal delivery statuses without Flow content remain uncertain', function (string $status) {
    $send = reconciliationSend();
    reconciliationHistory([reconciliationMessage($send, ['deliveryStatus' => $status, 'content' => null])]);

    expectReconciliationUncertain($send);
})->with(['ACCEPTED', 'ENQUEUED']);

test('provider failure details are not logged or persisted as ledger reasons', function () {
    Log::spy();
    $send = reconciliationSend();
    $detail = 'insufficient funds tenant-private recipient-private https://provider.example.test/private-token';
    reconciliationHistory([reconciliationMessage($send, ['deliveryStatusMessage' => $detail])]);

    (new ReconcileEdnaFlow($send->id))->handle();

    expect(DB::table('edna_flow_sends')->find($send->id)->reason)->toBe('outgoing_not_delivered');
    foreach (['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency', 'log'] as $level) {
        Log::shouldNotHaveReceived($level);
    }
    Http::assertSentCount(1);
});
