<?php

use App\Jobs\ReceiveEdnaInKestra;
use App\Jobs\ReconcileEdnaFlow;
use App\Jobs\SendEdnaFlow;
use App\Services\EdnaFlowRouter;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 9, 18)->setTime(15, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('x', 32)));
    config()->set('edna', ['enabled' => true, 'webhook_key' => 'incoming-key', 'auth_header' => 'Authorization',
        'subject_id' => '2423', 'kestra_url' => 'https://kestra.example.test/edna',
        'router_enabled' => true, 'router_start_at' => now()->subHour()->toIso8601String(),
        'router_recipients' => [], 'api_key' => 'outbound-key', 'cascade_id' => '2557']);
    Http::preventStrayRequests();
    routerHttp();
});

function routerHttp(array $overrides = []): void
{
    Http::swap(new Factory);
    Http::preventStrayRequests();
    Http::fake(array_merge([
        'kestra.example.test/*' => function ($r) {
            $kind = $r['messageContent']['type'] === 'FLOW' ? 'flow_response' : 'router_entry';

            return Http::response(['ok' => true, 'event_key' => $r['subjectId'].':'.$r['id'], 'kind' => $kind,
                'flow_id_verified' => $r['routerContext']['verified'] ?? false]);
        },
        'app.edna.io/api/cascade/get-all' => Http::response([['id' => 2557, 'status' => 'ACTIVE',
            'stages' => [['subject' => ['id' => 2423, 'locked' => false]]]]]),
        'app.edna.io/api/cascade/schedule' => fn ($r) => Http::response(['requestId' => $r['requestId']]),
        'app.edna.io/api/messages/history' => fn () => Http::response(['content' => [routerHistory()], 'hasNext' => false]),
    ], $overrides));
}

function routerHistory(array $overrides = []): array
{
    $s = DB::table('edna_flow_sends')->latest('id')->first();

    return array_replace(['messageId' => 900 + $s->id, 'comment' => $s->request_id, 'direction' => 'OUT',
        'channelType' => 'WHATSAPP', 'subjectId' => 2423, 'cascadeId' => 2557,
        'address' => Crypt::decryptString($s->recipient), 'deliveryStatus' => 'DELIVERED',
        'content' => json_encode(['type' => 'FLOW', 'flowId' => (int) EdnaFlowRouter::FLOW_ID])], $overrides);
}

function routerInbound(array $overrides = []): object
{
    $message = array_replace_recursive(['id' => (string) (1000 + DB::table('edna_incoming_events')->count()),
        'subjectId' => 2423, 'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => now()->toIso8601String(),
        'messageContent' => ['type' => 'TEXT', 'text' => 'Hola, vengo del sitio web de Red Unisol. ref=test']], $overrides);
    test()->postJson('/api/webhooks/edna/incoming', $message, ['Authorization' => 'Token incoming-key'])
        ->assertOk()->assertJsonPath('accepted', 1);

    return DB::table('edna_incoming_events')->latest('id')->first();
}

function routerReserve(): object
{
    $event = routerInbound();
    (new ReceiveEdnaInKestra($event->id))->handle();

    return DB::table('edna_flow_sends')->latest('id')->first();
}

function routerSendConfirmed(): object
{
    $s = routerReserve();
    (new SendEdnaFlow($s->id))->handle();
    (new ReconcileEdnaFlow($s->id))->handle();

    return DB::table('edna_flow_sends')->where('id', $s->id)->first();
}

function routerReply(object $s, array $overrides = []): object
{
    return routerInbound(array_replace_recursive([
        'replyOutMessageId' => $s->outgoing_message_id ?? (string) (900 + $s->id),
        'replyOutMessageExternalRequestId' => $s->request_id,
        'messageContent' => ['type' => 'FLOW', 'text' => json_encode(['provincia' => 'catamarca', 'situacion_catamarca' => 'policia'])],
    ], $overrides));
}

test('website entry creates one durable send and a queue job without disclosing the recipient', function () {
    $s = routerReserve();
    expect($s->state)->toBe('pending')->and($s->flow_id)->toBe(EdnaFlowRouter::FLOW_ID)
        ->and($s->recipient)->not->toContain('5493510000000')
        ->and(Crypt::decryptString($s->recipient))->toBe('5493510000000')
        ->and(DB::table('edna_incoming_events')->first()->router_action)->toBe('scheduled');
    $jobs = DB::table('jobs')->pluck('payload')->implode('');
    expect($jobs)->toContain('SendEdnaFlow')->not->toContain('5493510000000', 'outbound-key', 'incoming-key');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'app.edna.io'));
});

test('repeated entry messages and worker retries produce only one Flow in a rolling day', function () {
    $s = routerReserve();
    (new ReceiveEdnaInKestra($s->entry_event_id))->handle();
    $next = routerInbound();
    (new ReceiveEdnaInKestra($next->id))->handle();
    expect(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_incoming_events')->find($next->id)->router_action)->toBe('cooldown');
    (new SendEdnaFlow($s->id))->handle();
    (new SendEdnaFlow($s->id))->handle();
    Http::assertSentCount(4); // two classifications, one cascade check, one schedule
    $this->travel(25)->hours();
    $later = routerInbound();
    (new ReceiveEdnaInKestra($later->id))->handle();
    expect(DB::table('edna_flow_sends')->count())->toBe(2);
});

test('router gates exclude disabled, historical, stale, future, pilot and non-phone entries', function (string $gate, string $expected) {
    $overrides = [];
    match ($gate) {
        'disabled' => config()->set('edna.router_enabled', false),
        'before_activation' => config()->set('edna.router_start_at', now()->addMinute()->toIso8601String()),
        'stale' => [$overrides = ['receivedAt' => now()->subHours(24)->toIso8601String()], config()->set('edna.router_start_at', now()->subDays(2)->toIso8601String())],
        'future' => $overrides = ['receivedAt' => now()->addMinutes(6)->toIso8601String()],
        'pilot' => config()->set('edna.router_recipients', ['5493519999999']),
        'identifier' => $overrides = ['subscriber' => ['identifier' => 'not-a-phone']],
    };
    $e = routerInbound($overrides);
    (new ReceiveEdnaInKestra($e->id))->handle();
    expect(DB::table('edna_flow_sends')->count())->toBe(0)
        ->and(DB::table('edna_incoming_events')->find($e->id)->router_action)->toBe($expected);
})->with([['disabled', 'disabled'], ['before_activation', 'before_activation'], ['stale', 'outside_send_window'],
    ['future', 'outside_send_window'], ['pilot', 'outside_pilot'], ['identifier', 'unsupported_recipient']]);

test('failed send queue insert rolls back the reservation and inbox acknowledgement', function () {
    $e = routerInbound();
    Queue::shouldReceive('connection')->with('edna')->once()->andThrow(new RuntimeException('private'));
    expect(fn () => (new ReceiveEdnaInKestra($e->id))->handle())->toThrow(RuntimeException::class, 'Edna event delivery failed');
    expect(DB::table('edna_flow_sends')->count())->toBe(0)
        ->and(DB::table('edna_incoming_events')->find($e->id)->status)->toBe('pending');
});

test('a schedule timeout is reconciled from history and never causes a second POST', function () {
    $attempts = 0;
    routerHttp(['app.edna.io/api/cascade/schedule' => function () use (&$attempts) {
        $attempts++;
        throw new ConnectionException('private outgoing body');
    }]);
    $s = routerReserve();
    (new SendEdnaFlow($s->id))->handle();
    expect(DB::table('edna_flow_sends')->find($s->id)->state)->toBe('unknown');
    (new SendEdnaFlow($s->id))->handle();
    (new ReconcileEdnaFlow($s->id))->handle();
    expect(DB::table('edna_flow_sends')->find($s->id)->state)->toBe('confirmed');
    expect($attempts)->toBe(1);
});

test('interrupted sending state only queues history checks', function () {
    $s = routerReserve();
    DB::table('edna_flow_sends')->where('id', $s->id)->update(['state' => 'sending', 'send_started_at' => now()]);
    (new SendEdnaFlow($s->id))->handle();
    Http::assertNotSent(fn ($r) => str_ends_with($r->url(), '/cascade/schedule'));
    expect(DB::table('jobs')->pluck('payload')->implode(''))->toContain('ReconcileEdnaFlow');
});

test('disabled or expired pending sends are cancelled before external calls', function (bool $disabled) {
    $s = routerReserve();
    if ($disabled) {
        config()->set('edna.router_enabled', false);
    } else {
        $this->travel(24)->hours();
    }
    (new SendEdnaFlow($s->id))->handle();
    expect(DB::table('edna_flow_sends')->find($s->id)->state)->toBe($disabled ? 'cancelled' : 'expired');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'app.edna.io'));
})->with([true, false]);

test('wrong cascade cannot send a Flow to another channel', function () {
    routerHttp(['app.edna.io/api/cascade/get-all' => Http::response([['id' => 2557, 'status' => 'ACTIVE', 'stages' => [['subject' => ['id' => 2580]]]]])]);
    $s = routerReserve();
    expect(fn () => (new SendEdnaFlow($s->id))->handle())->toThrow(RuntimeException::class, 'Edna Flow job failed');
    expect(DB::table('edna_flow_sends')->find($s->id)->state)->toBe('pending');
    Http::assertNotSent(fn ($r) => str_ends_with($r->url(), '/cascade/schedule'));
});

test('history must confirm channel recipient Flow and request before correlation', function (string $mismatch) {
    $s = routerReserve();
    (new SendEdnaFlow($s->id))->handle();
    $bad = match ($mismatch) {
        'recipient' => ['address' => '5493519999999'], 'channel' => ['subjectId' => 2580],
        'flow' => ['content' => json_encode(['type' => 'FLOW', 'flowId' => 123])],
        'request' => ['comment' => 'other-request'], 'pending' => ['deliveryStatus' => 'ACCEPTED'],
    };
    routerHttp(['app.edna.io/api/messages/history' => Http::response(['content' => [routerHistory($bad)], 'hasNext' => false])]);
    expect(fn () => (new ReconcileEdnaFlow($s->id))->handle())->toThrow(RuntimeException::class, 'Edna Flow history unconfirmed');
    expect(DB::table('edna_flow_sends')->find($s->id)->outgoing_message_id)->toBeNull();
})->with(['recipient', 'channel', 'flow', 'request', 'pending']);

test('confirmed Flow response is correlated once and sent to Kestra with verified identity', function () {
    $s = routerSendConfirmed();
    $e = routerReply($s);
    (new ReceiveEdnaInKestra($e->id))->handle();
    $send = DB::table('edna_flow_sends')->find($s->id);
    expect($send->state)->toBe('completed')->and((int) $send->response_event_id)->toBe($e->id)
        ->and(DB::table('edna_incoming_events')->find($e->id)->router_action)->toBe('verified_response');
    Http::assertSent(fn ($r) => $r->url() === config('edna.kestra_url') && ($r['routerContext']['verified'] ?? false) === true
        && $r['routerContext']['flow_id'] === EdnaFlowRouter::FLOW_ID && $r['routerContext']['request_id'] === $s->request_id);
    $again = routerReply($s);
    (new ReceiveEdnaInKestra($again->id))->handle();
    expect(DB::table('edna_incoming_events')->find($again->id)->router_action)->toBe('duplicate_response')
        ->and((int) DB::table('edna_flow_sends')->find($s->id)->response_event_id)->toBe($e->id);
});

test('wrong recipient outgoing ID or request never becomes a verified response', function (string $field) {
    $s = routerSendConfirmed();
    $bad = match ($field) {
        'recipient' => ['subscriber' => ['identifier' => '5493519999999']],
        'outgoing' => ['replyOutMessageId' => '999999'], 'request' => ['replyOutMessageExternalRequestId' => 'unknown'],
    };
    $e = routerReply($s, $bad);
    (new ReceiveEdnaInKestra($e->id))->handle();
    expect(DB::table('edna_flow_sends')->find($s->id)->response_event_id)->toBeNull()
        ->and(DB::table('edna_incoming_events')->find($e->id)->router_action)->toBe('unmatched_response');
    Http::assertNotSent(fn ($r) => isset($r['routerContext']));
})->with(['recipient', 'outgoing', 'request']);

test('reply arriving before history is retried then correlated after confirmation', function () {
    $s = routerReserve();
    (new SendEdnaFlow($s->id))->handle();
    $e = routerReply($s);
    expect(fn () => (new ReceiveEdnaInKestra($e->id))->handle())->toThrow(RuntimeException::class);
    expect(DB::table('edna_incoming_events')->find($e->id)->status)->toBe('pending');
    (new ReconcileEdnaFlow($s->id))->handle();
    (new ReceiveEdnaInKestra($e->id))->handle();
    expect(DB::table('edna_incoming_events')->find($e->id)->router_action)->toBe('verified_response');
});

test('public callback cannot inject trusted correlation context', function () {
    $e = routerInbound(['routerContext' => ['verified' => true, 'flow_id' => EdnaFlowRouter::FLOW_ID]]);
    expect(json_decode(Crypt::decryptString($e->payload), true))->not->toHaveKey('routerContext');
});

test('history exhaustion stays uncertain and operator command cannot resend', function () {
    $s = routerReserve();
    (new SendEdnaFlow($s->id))->handle();
    (new ReconcileEdnaFlow($s->id))->failed(null);
    expect(DB::table('edna_flow_sends')->find($s->id)->state)->toBe('unknown');
    $this->artisan('edna:router', ['action' => 'reconcile', 'id' => $s->id])->assertSuccessful();
    $this->artisan('edna:router', ['action' => 'resend', 'id' => $s->id])->assertFailed();
    expect(Http::recorded(fn ($r) => str_ends_with($r->url(), '/cascade/schedule')))->toHaveCount(1);
});

test('a competing send worker after the durable claim cannot post another Flow', function () {
    $attempts = 0;
    routerHttp(['app.edna.io/api/cascade/schedule' => function ($r) use (&$attempts) {
        $attempts++;
        $send = DB::table('edna_flow_sends')->where('request_id', $r['requestId'])->first();
        expect($send->state)->toBe('sending');
        (new SendEdnaFlow($send->id))->handle();

        return Http::response(['requestId' => $r['requestId']]);
    }]);
    $s = routerReserve();
    (new SendEdnaFlow($s->id))->handle();
    expect($attempts)->toBe(1);
    Http::assertSent(fn ($r) => str_ends_with($r->url(), '/cascade/schedule')
        && $r->hasHeader('X-API-KEY', 'outbound-key') && $r['cascadeId'] === '2557'
        && $r['content']['whatsappContent']['flowId'] === 1850162769693486
        && $r['subscriberFilter'] === ['address' => '5493510000000', 'type' => 'PHONE']);
});

test('schedule rejection and ambiguous acknowledgement remain distinct and never resend', function (int $code, array $body, string $state) {
    routerHttp(['app.edna.io/api/cascade/schedule' => Http::response($body, $code)]);
    $s = routerReserve();
    (new SendEdnaFlow($s->id))->handle();
    (new SendEdnaFlow($s->id))->handle();
    expect(DB::table('edna_flow_sends')->find($s->id)->state)->toBe($state);
    expect(Http::recorded(fn ($r) => str_ends_with($r->url(), '/cascade/schedule')))->toHaveCount(1);
})->with([[400, ['code' => 'invalid'], 'rejected'], [401, [], 'rejected'], [500, [], 'unknown'],
    [429, [], 'unknown'], [200, ['requestId' => 'wrong'], 'unknown']]);

test('ambiguous or incomplete history cannot verify a send', function (bool $truncated) {
    $s = routerReserve();
    (new SendEdnaFlow($s->id))->handle();
    $messages = $truncated ? [routerHistory()] : [routerHistory(), routerHistory(['messageId' => 9999])];
    routerHttp(['app.edna.io/api/messages/history' => Http::response(['content' => $messages, 'hasNext' => $truncated])]);
    expect(fn () => (new ReconcileEdnaFlow($s->id))->handle())->toThrow(RuntimeException::class);
    expect(DB::table('edna_flow_sends')->find($s->id)->outgoing_message_id)->toBeNull();
})->with([true, false]);

test('missing Kestra verification leaves the response available for retry after deployment', function () {
    $s = routerSendConfirmed();
    $e = routerReply($s);
    routerHttp(['kestra.example.test/*' => Http::response(['ok' => true, 'event_key' => '2423:'.$e->message_id, 'kind' => 'flow_response'])]);
    expect(fn () => (new ReceiveEdnaInKestra($e->id))->handle())->toThrow(RuntimeException::class);
    expect(DB::table('edna_flow_sends')->find($s->id)->state)->toBe('confirmed')
        ->and(DB::table('edna_incoming_events')->find($e->id)->status)->toBe('pending');
});

test('malformed or late responses do not consume the send', function (bool $late) {
    $s = routerSendConfirmed();
    if ($late) {
        $this->travel(25)->hours();
    }
    $e = routerReply($s);
    if (! $late) {
        routerHttp(['kestra.example.test/*' => Http::response(['ok' => true, 'event_key' => '2423:'.$e->message_id, 'kind' => 'invalid'])]);
    }
    (new ReceiveEdnaInKestra($e->id))->handle();
    expect(DB::table('edna_flow_sends')->find($s->id)->response_event_id)->toBeNull()
        ->and(DB::table('edna_incoming_events')->find($e->id)->router_action)->toBe($late ? 'response_outside_window' : 'invalid_response');
})->with([true, false]);

test('unrelated text classified by Kestra cannot trigger a send', function () {
    $e = routerInbound(['messageContent' => ['text' => 'Hola']]);
    routerHttp(['kestra.example.test/*' => Http::response(['ok' => true, 'event_key' => '2423:'.$e->message_id, 'kind' => 'ignored'])]);
    (new ReceiveEdnaInKestra($e->id))->handle();
    expect(DB::table('edna_flow_sends')->count())->toBe(0);
});

test('retention clears closed recipients but retains uncertain sends and deduplication records', function () {
    $s = routerSendConfirmed();
    $this->travel(25)->hours();
    $unknown = routerReserve();
    DB::table('edna_flow_sends')->where('id', $unknown->id)->update(['state' => 'unknown']);
    $this->travel(31)->days();
    $this->artisan('edna:prune')->assertSuccessful();
    expect(DB::table('edna_flow_sends')->find($s->id)->recipient)->toBeNull()
        ->and(DB::table('edna_flow_sends')->find($unknown->id)->recipient)->not->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(2);
});

test('incomplete enabled configuration leaves the entry pending without sending', function (string $key) {
    config()->set('edna.'.$key, '');
    $e = routerInbound();
    expect(fn () => (new ReceiveEdnaInKestra($e->id))->handle())->toThrow(RuntimeException::class);
    expect(DB::table('edna_flow_sends')->count())->toBe(0)
        ->and(DB::table('edna_incoming_events')->find($e->id)->status)->toBe('pending');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'app.edna.io'));
})->with(['api_key', 'cascade_id', 'router_start_at']);
