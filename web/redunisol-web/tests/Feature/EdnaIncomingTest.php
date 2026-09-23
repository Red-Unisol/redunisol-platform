<?php

use App\Jobs\ReceiveEdnaInKestra;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('x', 32)));
    config()->set('edna', [
        'enabled' => true, 'webhook_key' => 'inbound-test-key', 'auth_header' => 'X-API-KEY',
        'subject_id' => '2423', 'kestra_url' => 'https://kestra.example.test/webhook/test-key',
    ]);
    Http::preventStrayRequests();
});

function ednaMessage(array $overrides = []): array
{
    return array_replace_recursive([
        'id' => 101, 'subjectId' => 2423,
        'subscriber' => ['identifier' => '5493510000000'],
        'receivedAt' => '2026-09-17T12:00:00Z',
        'messageContent' => ['type' => 'TEXT', 'text' => 'Hola, vengo del sitio web de Red Unisol.'],
    ], $overrides);
}

function sendEdna(array $messages)
{
    return test()->postJson('/api/webhooks/edna/incoming', $messages, ['X-API-KEY' => 'inbound-test-key']);
}

test('HEAD verifies availability without credentials, writes or jobs', function () {
    $this->call('HEAD', '/api/webhooks/edna/incoming')->assertOk()->assertContent('');
    expect(DB::table('edna_incoming_events')->count())->toBe(0)
        ->and(DB::table('jobs')->count())->toBe(0);
    $this->getJson('/api/webhooks/edna/incoming')->assertNotFound();
});

test('receiver fails closed when disabled or incompletely configured', function (string $setting, mixed $value) {
    config()->set('edna.'.$setting, $value);
    sendEdna([ednaMessage()])->assertStatus(503);
    $this->call('HEAD', '/api/webhooks/edna/incoming')->assertStatus(503);
    expect(DB::table('jobs')->count())->toBe(0);
})->with([
    ['enabled', false], ['webhook_key', ''], ['subject_id', ''], ['kestra_url', 'http://insecure.test'],
]);

test('POST requires the webhook credential and supports a configured header name', function () {
    $this->postJson('/api/webhooks/edna/incoming', [ednaMessage()])->assertUnauthorized();
    $this->postJson('/api/webhooks/edna/incoming', [ednaMessage()], ['X-API-KEY' => 'wrong'])->assertUnauthorized();
    config()->set('edna.auth_header', 'X-Edna-Webhook-Key');
    $this->postJson('/api/webhooks/edna/incoming', [ednaMessage()], ['X-Edna-Webhook-Key' => 'inbound-test-key'])
        ->assertOk()->assertJsonPath('accepted', 1);
    config()->set('edna.auth_header', 'Authorization');
    $this->postJson('/api/webhooks/edna/incoming', [ednaMessage(['id' => 102])], ['Authorization' => 'inbound-test-key'])
        ->assertOk()->assertJsonPath('accepted', 1);
    $this->postJson('/api/webhooks/edna/incoming', [ednaMessage(['id' => 103])], ['Authorization' => 'Bearer inbound-test-key'])
        ->assertUnauthorized();
});

test('Authorization accepts the observed Token scheme with the exact configured key', function (string $scheme) {
    config()->set('edna.auth_header', 'Authorization');
    $this->postJson('/api/webhooks/edna/incoming', [ednaMessage()], ['Authorization' => $scheme.' inbound-test-key'])
        ->assertOk()->assertJsonPath('accepted', 1);
    expect(DB::table('edna_incoming_events')->count())->toBe(1)->and(DB::table('jobs')->count())->toBe(1);
})->with(['Token', 'token', 'TOKEN']);

test('invalid Token credentials cannot persist or enqueue callbacks', function (string $credential) {
    config()->set('edna.auth_header', 'Authorization');
    $this->postJson('/api/webhooks/edna/incoming', [ednaMessage()], ['Authorization' => $credential])
        ->assertUnauthorized();
    expect(DB::table('edna_incoming_events')->count())->toBe(0)->and(DB::table('jobs')->count())->toBe(0);
})->with(['Token wrong', 'Token ', 'Token Token inbound-test-key', 'Token  inbound-test-key',
    'Token inbound-test-key extra', 'Tokeninbound-test-key', 'Basic inbound-test-key', 'Bearer inbound-test-key']);

test('Token scheme is not stripped from a custom credential header', function () {
    $this->postJson('/api/webhooks/edna/incoming', [ednaMessage()], ['X-API-KEY' => 'Token inbound-test-key'])
        ->assertUnauthorized();
    expect(DB::table('edna_incoming_events')->count())->toBe(0)->and(DB::table('jobs')->count())->toBe(0);
});

test('callback deduplicates in the database and stores encrypted minimal data', function () {
    $message = ednaMessage(['userInfo' => ['userName' => 'Not stored']]);
    sendEdna([$message, $message])->assertOk()->assertJsonPath('accepted', 1)->assertJsonPath('duplicates', 1);
    sendEdna([$message])->assertOk()->assertJsonPath('duplicates', 1);
    expect(DB::table('edna_incoming_events')->count())->toBe(1)->and(DB::table('jobs')->count())->toBe(1);
    $event = DB::table('edna_incoming_events')->first();
    expect($event->payload)->not->toContain('5493510000000');
    $payload = json_decode(Crypt::decryptString($event->payload), true);
    expect($payload['subscriber']['identifier'])->toBe('5493510000000')->and($payload)->not->toHaveKey('userInfo');
    expect(DB::table('jobs')->first()->payload)->not->toContain('inbound-test-key', '5493510000000');
});

test('mixed batches isolate other channels and unsupported or malformed events', function () {
    sendEdna([
        ednaMessage(), ednaMessage(['id' => 102, 'subjectId' => 2580]),
        ednaMessage(['id' => 103, 'messageContent' => ['type' => 'IMAGE']]),
        ['id' => 104, 'subjectId' => 2423], null,
    ])->assertOk()->assertJson(['accepted' => 1, 'duplicates' => 0, 'ignored' => 2, 'invalid' => 2]);
    expect(DB::table('jobs')->count())->toBe(1);
});

test('invalid transport bodies are rejected without persistence', function () {
    sendEdna(['unexpected' => 'object'])->assertStatus(400);
    sendEdna(array_fill(0, 101, ednaMessage()))->assertStatus(400);
    $this->call('POST', '/api/webhooks/edna/incoming', [], [], [], [
        'CONTENT_TYPE' => 'application/json', 'HTTP_X_API_KEY' => 'inbound-test-key',
    ], '{broken')->assertStatus(400);
    sendEdna([ednaMessage(['messageContent' => ['text' => str_repeat('x', 1048577)]])])->assertStatus(413);
    expect(DB::table('edna_incoming_events')->count())->toBe(0);
});

test('single TEXT objects and FLOW batches share the same durable inbox', function () {
    sendEdna(ednaMessage())->assertOk()->assertJsonPath('accepted', 1);
    $flow = ednaMessage(['id' => 102, 'messageContent' => [
        'type' => 'FLOW', 'text' => json_encode(['provincia' => 'caba', 'situacion_caba' => 'pfa']),
    ]]);
    sendEdna([$flow])->assertOk()->assertJsonPath('accepted', 1);
    sendEdna([ednaMessage(), $flow])->assertOk()->assertJsonPath('duplicates', 2);
    expect(DB::table('jobs')->count())->toBe(2);
});

test('queue failure rolls back the inbox so Edna can retry the complete batch', function () {
    Queue::shouldReceive('connection')->with('edna')->once()->andThrow(new RuntimeException('private failure'));
    sendEdna([ednaMessage()])->assertStatus(503)->assertExactJson(['code' => 'temporarily_unavailable']);
    expect(DB::table('edna_incoming_events')->count())->toBe(0);
});

test('single FLOW callback preserves reply references through encrypted inbox and Kestra forwarding', function () {
    $message = ednaMessage(['messageContent' => ['type' => 'FLOW', 'text' => json_encode([
        'provincia' => 'cordoba', 'situacion_cordoba' => 'jubilado_pensionado', 'flow_token' => 'test-token',
    ])], 'replyOutMessageId' => 98765, 'replyOutMessageExternalRequestId' => 'flow-test-request',
        'userInfo' => ['displayName' => 'Private name']]);
    sendEdna($message)->assertOk()->assertJsonPath('accepted', 1);
    $event = DB::table('edna_incoming_events')->first();
    expect($event->payload)->not->toContain('flow-test-request', 'Private name');
    Http::fake(['kestra.example.test/*' => Http::response(['ok' => true, 'event_key' => '2423:101', 'kind' => 'flow_response'])]);
    (new ReceiveEdnaInKestra($event->id))->handle();
    Http::assertSent(fn ($request) => $request['replyOutMessageId'] === '98765'
        && $request['replyOutMessageExternalRequestId'] === 'flow-test-request'
        && ! isset($request['userInfo']));
    expect(DB::table('edna_incoming_events')->first()->outcome)->toBe('flow_response');
});

test('malformed reply references are rejected while absent or null references stay compatible', function () {
    sendEdna([
        ednaMessage(['id' => 101, 'replyOutMessageId' => true]),
        ednaMessage(['id' => 102, 'replyOutMessageExternalRequestId' => []]),
        ednaMessage(['id' => 103, 'replyOutMessageExternalRequestId' => str_repeat('x', 257)]),
        ednaMessage(['id' => 104, 'replyOutMessageId' => null, 'replyOutMessageExternalRequestId' => null]),
        ednaMessage(['id' => 105]),
    ])->assertOk()->assertJson(['accepted' => 2, 'invalid' => 3]);
    expect(DB::table('jobs')->count())->toBe(2);
});

test('worker records matching Kestra acknowledgement and skips duplicate jobs', function () {
    sendEdna([ednaMessage()])->assertOk();
    Http::fake(['kestra.example.test/*' => Http::response(['ok' => true, 'event_key' => '2423:101', 'kind' => 'router_entry'])]);
    $id = DB::table('edna_incoming_events')->value('id');
    $job = new ReceiveEdnaInKestra($id);
    $job->handle();
    $job->handle();
    Http::assertSentCount(1);
    expect(DB::table('edna_incoming_events')->first()->status)->toBe('delivered');
});

test('worker rejects missing or mismatched acknowledgements and can recover', function (array $response, int $status) {
    sendEdna([ednaMessage()])->assertOk();
    $id = DB::table('edna_incoming_events')->value('id');
    Http::fake(['kestra.example.test/*' => Http::sequence()
        ->push($response, $status)
        ->push(['ok' => true, 'event_key' => '2423:101', 'kind' => 'router_entry'])]);
    $job = new ReceiveEdnaInKestra($id);
    expect(fn () => $job->handle())->toThrow(RuntimeException::class, 'Edna event delivery failed; retry using the event ID.');
    expect(DB::table('edna_incoming_events')->first()->status)->toBe('pending');
    $job->failed(null);
    expect(DB::table('edna_incoming_events')->first()->status)->toBe('failed');
    $job->handle();
    expect(DB::table('edna_incoming_events')->first()->status)->toBe('delivered');
})->with([
    [[], 503], [['ok' => false], 200], [['ok' => true, 'event_key' => 'wrong', 'kind' => 'router_entry'], 200],
    [['id' => 'execution-only'], 200],
]);

test('connection failures never expose the URL or payload in failed jobs', function () {
    sendEdna([ednaMessage()])->assertOk();
    Http::fake(fn () => throw new RuntimeException('https://kestra.example.test/webhook/test-key subscriber 5493510000000'));
    $job = new ReceiveEdnaInKestra(DB::table('edna_incoming_events')->value('id'));
    try {
        $job->handle();
        $this->fail('Expected a delivery failure');
    } catch (RuntimeException $exception) {
        expect($exception->getMessage())->not->toContain('test-key', '5493510000000')
            ->and($exception->getPrevious())->toBeNull();
    }
});

test('pruning removes only old delivered payloads and retains duplicate protection', function () {
    sendEdna([ednaMessage(), ednaMessage(['id' => 102]), ednaMessage(['id' => 103])])->assertOk();
    DB::table('edna_incoming_events')->where('message_id', '101')
        ->update(['status' => 'delivered', 'delivered_at' => now()->subDays(31)]);
    DB::table('edna_incoming_events')->where('message_id', '102')
        ->update(['status' => 'delivered', 'delivered_at' => now()]);
    $this->artisan('edna:prune')->assertSuccessful();
    expect(DB::table('edna_incoming_events')->whereNull('payload')->pluck('message_id')->all())->toBe(['101']);
    sendEdna([ednaMessage()])->assertOk()->assertJsonPath('duplicates', 1);
    expect(DB::table('edna_incoming_events')->count())->toBe(3)->and(DB::table('jobs')->count())->toBe(3);
    $this->artisan('edna:prune --days=0')->assertFailed();
});
