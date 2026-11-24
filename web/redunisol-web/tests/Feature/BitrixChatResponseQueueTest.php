<?php

use App\Services\BitrixChatResponseQueue;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('x', 32)));
    config()->set('services.bitrix_routing.allocation_token', 'test-queue-token');
    config()->set('chat_response.scope', 'redunisol.prod.marketing-crm');
});

function chatQueue(string $action, array $data = [])
{
    return test()->withToken('test-queue-token')->postJson('/api/internal/bitrix-chat-response/'.$action,
        ['scope' => 'redunisol.prod.marketing-crm', ...$data]);
}

function captureChat(int $id = 1, string $phone = '5493510000000'): void
{
    (new BitrixChatResponseQueue)->capture((object) ['id' => $id], [
        'subscriber' => ['identifier' => $phone], 'receivedAt' => now()->toIso8601String(),
        'messageContent' => ['type' => 'TEXT', 'text' => 'hello'],
    ]);
}

test('queue rejects missing auth and another environment before claiming', function () {
    $this->postJson('/api/internal/bitrix-chat-response/claim')->assertUnauthorized();
    chatQueue('claim', ['scope' => 'redunisol.dev.marketing-crm'])->assertForbidden();
    expect(DB::table('bitrix_chat_response_state')->count())->toBe(0);
});

test('messages coalesce by phone and duplicate delivery does not create another generation', function () {
    captureChat(1);
    captureChat(1);
    captureChat(2);
    $row = DB::table('bitrix_chat_response_queue')->sole();
    expect($row->version)->toBe(2)->and($row->event_id)->toBe(2)
        ->and($row->payload)->not->toContain('5493510000000');
    $this->travel(16)->seconds();
    $claim = chatQueue('claim')->assertOk()->assertJsonPath('mode', 'event')->json();
    expect($claim['payload']['phone'])->toBe('5493510000000');
    chatQueue('claim')->assertOk()->assertJsonPath('mode', 'busy');
});

test('an event arriving during processing survives the first acknowledgement', function () {
    captureChat(1);
    $this->travel(16)->seconds();
    $first = chatQueue('claim')->json();
    captureChat(2);
    chatQueue('finish', ['lease' => $first['lease'], 'outcome' => 'completed', 'cursor' => 900])->assertOk();
    $next = chatQueue('claim')->assertJsonPath('mode', 'event')->json();
    expect($next['cursor'])->toBe(0);
    chatQueue('finish', ['lease' => $first['lease'], 'outcome' => 'completed', 'cursor' => 0])->assertConflict();
});

test('continuous messages cannot postpone the first review indefinitely', function () {
    captureChat(1);
    $this->travel(10)->seconds();
    captureChat(2);
    $this->travel(6)->seconds();
    chatQueue('claim')->assertJsonPath('mode', 'event');
});

test('expired leases can be reclaimed and the old owner cannot renew or acknowledge', function () {
    captureChat();
    $this->travel(16)->seconds();
    $first = chatQueue('claim')->json();
    $this->travel(181)->seconds();
    $next = chatQueue('claim')->assertJsonPath('mode', 'event')->json();
    expect($first['lease'])->not->toBe($next['lease']);
    chatQueue('renew', ['lease' => $first['lease']])->assertConflict();
    chatQueue('finish', ['lease' => $first['lease'], 'outcome' => 'completed', 'cursor' => 0])->assertConflict();
    chatQueue('renew', ['lease' => $next['lease']])->assertOk();
});

test('fallback keeps its cursor and runs only once per reconciliation interval', function () {
    $claim = chatQueue('claim')->assertJsonPath('mode', 'fallback')->json();
    chatQueue('finish', ['lease' => $claim['lease'], 'outcome' => 'retry', 'cursor' => 250, 'calls' => 20])->assertOk();
    chatQueue('claim')->assertJsonPath('mode', 'idle');
    $this->travel(901)->seconds();
    chatQueue('claim')->assertJsonPath('mode', 'fallback')->assertJsonPath('cursor', 250);
});

test('classification notices are durable and idempotent for an execution', function () {
    chatQueue('enqueue', ['deal_id' => 123, 'source' => 'exec-1'])->assertOk();
    chatQueue('enqueue', ['deal_id' => 123, 'source' => 'exec-1'])->assertOk();
    expect(DB::table('bitrix_chat_response_queue')->sole()->version)->toBe(1);
    $this->travel(16)->seconds();
    chatQueue('claim')->assertJsonPath('mode', 'event')->assertJsonPath('payload.deal_id', 123);
});

test('a deferred batch retains its progress and does not spin immediately', function () {
    captureChat();
    $this->travel(16)->seconds();
    $claim = chatQueue('claim')->json();
    chatQueue('finish', ['lease' => $claim['lease'], 'outcome' => 'retry', 'cursor' => 22])->assertOk();
    chatQueue('claim')->assertJsonPath('mode', 'fallback');
    $this->travel(181)->seconds();
    chatQueue('claim')->assertJsonPath('mode', 'event')->assertJsonPath('cursor', 22);
});

test('response worker reserves alternate turns for fresh generations and overdue work', function () {
    $queue = new BitrixChatResponseQueue;
    $queue->deal(100, 'old');
    $queue->deal(101, 'old');
    $this->travel(2)->hours();
    $queue->deal(102, 'fresh');
    $queue->deal(103, 'fresh');
    $this->travel(16)->seconds();

    foreach ([102, 100, 103, 101] as $expected) {
        $claim = chatQueue('claim')->assertOk()->assertJsonPath('payload.deal_id', $expected)->json();
        chatQueue('finish', ['lease' => $claim['lease'], 'outcome' => 'completed', 'cursor' => 0])->assertOk();
    }
});

test('an updated old key counts as a fresh generation and an unattempted old key keeps its turn', function () {
    $queue = new BitrixChatResponseQueue;
    $queue->deal(10, 'old');
    $queue->deal(20, 'old');
    $this->travel(2)->hours();
    $queue->deal(20, 'new');
    $claim = chatQueue('claim')->assertJsonPath('payload.deal_id', 20)->json();
    chatQueue('finish', ['lease' => $claim['lease'], 'outcome' => 'retry', 'cursor' => 7])->assertOk();
    chatQueue('claim')->assertJsonPath('payload.deal_id', 10);
});

test('a continuously nonempty queue leaves a bounded turn for CRM reconciliation', function () {
    $queue = new BitrixChatResponseQueue;
    $queue->deal(100, 'old');
    $queue->deal(101, 'old');
    $this->travel(16)->seconds();
    $event = chatQueue('claim')->assertJsonPath('mode', 'event')->json();
    chatQueue('finish', ['lease' => $event['lease'], 'outcome' => 'completed', 'cursor' => 0])->assertOk();
    $this->travel(901)->seconds();
    $sweep = chatQueue('claim')->assertJsonPath('mode', 'fallback')->json();
    // Simulate a crashed worker: an expired fallback must not immediately reclaim.
    $this->travel(181)->seconds();
    chatQueue('claim')->assertJsonPath('mode', 'event')->assertJsonPath('payload.deal_id', 101);
    chatQueue('finish', ['lease' => $sweep['lease'], 'outcome' => 'completed', 'cursor' => 0])->assertConflict();
});
