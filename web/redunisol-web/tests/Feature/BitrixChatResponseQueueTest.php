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
