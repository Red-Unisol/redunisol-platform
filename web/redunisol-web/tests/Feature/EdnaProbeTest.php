<?php

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('x', 32)));
});

function startEdnaProbe(): array
{
    Artisan::call('edna:probe', ['action' => 'start', '--minutes' => 10]);

    return json_decode(Artisan::output(), true, 32, JSON_THROW_ON_ERROR);
}

function ednaProbeEvent(array $probe): array
{
    return ['id' => 1, 'subjectId' => 2423, 'subscriber' => ['identifier' => '5493510000000'],
        'messageContent' => ['type' => 'TEXT', 'text' => $probe['marker']]];
}

test('probe is opt-in, private to the console and expires without extending on HEAD', function () {
    $probe = startEdnaProbe();
    $this->call('HEAD', $probe['path'])->assertOk()->assertContent('');
    $this->getJson($probe['path'])->assertNotFound();
    $this->call('HEAD', '/api/webhooks/edna/probe/'.fake()->uuid())->assertNotFound();
    expect(Cache::get('edna-probe-result:'.$probe['id']))->toBeNull();
    expect(Cache::get('edna-probe-captures:'.$probe['id']))->toBeNull();
    $this->travel(11)->minutes();
    $this->call('HEAD', $probe['path'])->assertNotFound();
    $this->postJson($probe['path'], [ednaProbeEvent($probe)])->assertNotFound();
});

test('probe records only header names and fixed formats for the exact test message', function () {
    $probe = startEdnaProbe();
    $this->postJson($probe['path'], [ednaProbeEvent($probe)], [
        'X-API-KEY' => 'sensitive-webhook-key', 'Authorization' => 'Bearer sensitive-token',
        'Cookie' => 'session=sensitive-cookie',
    ])->assertExactJson(['code' => 'ok']);
    $result = Cache::get('edna-probe-result:'.$probe['id']);
    expect($result['headers']['x-api-key'])->toBe('raw')
        ->and($result['headers']['authorization'])->toBe('bearer')
        ->and(array_keys($result))->toBe(['observed_at', 'headers']);
    $stored = json_encode($result);
    expect($stored)->not->toContain('sensitive-', '5493510000000', $probe['marker']);
    expect(DB::table('edna_incoming_events')->count())->toBe(0)->and(DB::table('jobs')->count())->toBe(0);
    Artisan::call('edna:probe', ['action' => 'show', 'id' => $probe['id']]);
    expect(json_decode(Artisan::output(), true)['result'])->toBe($result);
});

test('unrelated traffic and other channels do not generate or overwrite observations', function () {
    $probe = startEdnaProbe();
    $message = ednaProbeEvent($probe);
    $message['messageContent']['text'] = 'An actual customer conversation';
    $this->postJson($probe['path'], $message, ['X-API-KEY' => 'key'])->assertOk();
    $message = ednaProbeEvent($probe);
    $message['subjectId'] = 2580;
    $this->postJson($probe['path'], [$message])->assertOk();
    expect(Cache::get('edna-probe-result:'.$probe['id']))->toBeNull();
    $this->postJson($probe['path'], ednaProbeEvent($probe), ['Authorization' => 'Basic fake'])->assertOk();
    $result = Cache::get('edna-probe-result:'.$probe['id']);
    expect($result['headers']['authorization'])->toBe('basic');
    $this->postJson($probe['path'], [$message])->assertOk();
    expect(Cache::get('edna-probe-result:'.$probe['id']))->toBe($result);
});

test('invalid probe transport is rejected without recording data', function () {
    $probe = startEdnaProbe();
    $this->postJson($probe['path'], ['invalid' => 'envelope'])->assertStatus(400);
    $this->call('POST', $probe['path'], [], [], [], ['CONTENT_TYPE' => 'application/json'], '{broken')->assertStatus(400);
    $this->postJson($probe['path'], ['text' => str_repeat('x', 1048577)])->assertStatus(400);
    expect(Cache::get('edna-probe-result:'.$probe['id']))->toBeNull();
});

test('stop removes both observation and access and validates operator inputs', function () {
    $probe = startEdnaProbe();
    $this->postJson($probe['path'], [ednaProbeEvent($probe)])->assertOk();
    $this->artisan('edna:probe', ['action' => 'stop', 'id' => $probe['id']])->assertSuccessful();
    expect(Cache::get('edna-probe:'.$probe['id']))->toBeNull()
        ->and(Cache::get('edna-probe-result:'.$probe['id']))->toBeNull();
    $this->call('HEAD', $probe['path'])->assertNotFound();
    $this->artisan('edna:probe', ['action' => 'start', '--minutes' => 241])->assertFailed();
    $this->artisan('edna:probe', ['action' => 'start', '--subject' => 'invalid'])->assertFailed();
    $this->artisan('edna:probe', ['action' => 'show', 'id' => 'not-an-id'])->assertFailed();
});

test('expanded capture is opt-in and preserves unexpected bodies encrypted without header values', function () {
    $probe = startEdnaProbe();
    $body = '{"unexpected":{"conversation":"Customer conversation", "subjectId":2580}}';
    $headers = ['CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer sensitive-secret'];
    $this->call('POST', $probe['path'], [], [], [], $headers, $body)->assertStatus(400);
    expect(Cache::get('edna-probe-captures:'.$probe['id']))->toBeNull();
    $this->artisan('edna:probe', ['action' => 'capture', 'id' => $probe['id']])->assertSuccessful();
    $settings = Cache::get('edna-probe:'.$probe['id']);
    expect($settings['marker'])->toBe($probe['marker'])
        ->and($settings['expires_at'])->toBe($probe['expires_at']);
    $this->call('HEAD', $probe['path'])->assertOk();
    expect(Cache::get('edna-probe-captures:'.$probe['id']))->toBeNull();
    $this->call('POST', $probe['path'], [], [], [], $headers, $body)->assertStatus(400);
    $stored = Cache::get('edna-probe-captures:'.$probe['id']);
    expect($stored)->toHaveCount(1)
        ->and($stored[0]['outcome'])->toBe('unexpected_envelope')
        ->and($stored[0]['headers']['authorization'])->toBe('bearer')
        ->and(Crypt::decryptString($stored[0]['encrypted_body']))->toBe($body)
        ->and(json_encode($stored))->not->toContain('Customer conversation', 'sensitive-secret');
    Artisan::call('edna:probe', ['action' => 'show', 'id' => $probe['id']]);
    $output = Artisan::output();
    expect($output)->not->toContain('Customer conversation', 'encrypted_body', 'body_base64', 'sensitive-secret');
    Artisan::call('edna:probe', ['action' => 'show', 'id' => $probe['id'], '--payload' => true]);
    expect(base64_decode(json_decode(Artisan::output(), true)['captures'][0]['body_base64']))->toBe($body);
    $this->getJson($probe['path'])->assertNotFound();
    expect(DB::table('edna_incoming_events')->count())->toBe(0)->and(DB::table('jobs')->count())->toBe(0);
});

test('expanded capture classifies transport failures and matched and unmatched messages', function (string $body, string $type, string $outcome, int $status) {
    $probe = startEdnaProbe();
    $this->artisan('edna:probe', ['action' => 'capture', 'id' => $probe['id']])->assertSuccessful();
    if ($body === 'MATCH') {
        $body = json_encode(ednaProbeEvent($probe));
    }
    $this->call('POST', $probe['path'], [], [], [], ['CONTENT_TYPE' => $type], $body)->assertStatus($status);
    $capture = Cache::get('edna-probe-captures:'.$probe['id'])[0];
    expect($capture['outcome'])->toBe($outcome)
        ->and($capture['is_json'])->toBe($type === 'application/json')
        ->and($capture['body_bytes'])->toBe(strlen($body))
        ->and(Crypt::decryptString($capture['encrypted_body']))->toBe(substr($body, 0, 65536));
})->with([
    ['message=hello', 'application/x-www-form-urlencoded', 'not_json', 400],
    ["{broken\xff", 'application/json', 'invalid_json', 400],
    ['null', 'application/json', 'unexpected_envelope', 400],
    ['[{"subjectId":2580,"id":1,"messageContent":{"type":"TEXT","text":"hello"}}]', 'application/json', 'no_match', 200],
    ['MATCH', 'application/json', 'matched', 200],
    [str_repeat('x', 1048577), 'application/json', 'too_large', 400],
]);

test('capture bounds bodies and event count and reports the limit without overwriting evidence', function () {
    $probe = startEdnaProbe();
    $this->artisan('edna:probe', ['action' => 'capture', 'id' => $probe['id']])->assertSuccessful();
    for ($i = 0; $i < 22; $i++) {
        $this->postJson($probe['path'], ['sequence' => $i, 'text' => str_repeat('x', 70000)])->assertStatus(400);
    }
    $captures = Cache::get('edna-probe-captures:'.$probe['id']);
    expect($captures)->toHaveCount(20)
        ->and($captures[0]['truncated'])->toBeTrue()
        ->and(strlen(Crypt::decryptString($captures[0]['encrypted_body'])))->toBe(65536)
        ->and(Crypt::decryptString($captures[0]['encrypted_body']))->toStartWith('{"sequence":0,')
        ->and(Crypt::decryptString($captures[19]['encrypted_body']))->toStartWith('{"sequence":19,');
    Artisan::call('edna:probe', ['action' => 'show', 'id' => $probe['id']]);
    expect(json_decode(Artisan::output(), true)['capture_limit_reached'])->toBeTrue();
});

test('capture stops at its deadline and retained data expires with the probe', function () {
    $probe = startEdnaProbe();
    $this->artisan('edna:probe', ['action' => 'capture', 'id' => $probe['id'], '--capture-minutes' => 1])->assertSuccessful();
    $this->postJson($probe['path'], [ednaProbeEvent($probe)])->assertOk();
    $this->travel(2)->minutes();
    $this->postJson($probe['path'], [ednaProbeEvent($probe)])->assertOk();
    Artisan::call('edna:probe', ['action' => 'show', 'id' => $probe['id']]);
    $result = json_decode(Artisan::output(), true);
    expect($result['active'])->toBeTrue()->and($result['capture_active'])->toBeFalse()
        ->and($result['captures'])->toHaveCount(1);
    $this->travel(9)->minutes();
    $this->postJson($probe['path'], [ednaProbeEvent($probe)])->assertNotFound();
    Artisan::call('edna:probe', ['action' => 'show', 'id' => $probe['id'], '--payload' => true]);
    $result = json_decode(Artisan::output(), true);
    expect($result['active'])->toBeFalse()->and($result['captures'])->toBe([])
        ->and(Cache::get('edna-probe-captures:'.$probe['id']))->toBeNull();
    $this->artisan('edna:probe', ['action' => 'capture', 'id' => $probe['id']])->assertFailed();
});

test('stop deletes encrypted captures and capture validates its duration and target', function () {
    $probe = startEdnaProbe();
    $this->artisan('edna:probe', ['action' => 'capture', 'id' => $probe['id'], '--capture-minutes' => 31])->assertFailed();
    $this->artisan('edna:probe', ['action' => 'capture', 'id' => $probe['id'], '--capture-minutes' => 0])->assertFailed();
    $this->artisan('edna:probe', ['action' => 'capture', 'id' => fake()->uuid()])->assertFailed();
    $this->artisan('edna:probe', ['action' => 'capture', 'id' => $probe['id']])->assertSuccessful();
    $this->postJson($probe['path'], [ednaProbeEvent($probe)])->assertOk();
    $this->artisan('edna:probe', ['action' => 'stop', 'id' => $probe['id']])->assertSuccessful();
    expect(Cache::get('edna-probe-captures:'.$probe['id']))->toBeNull();
    $this->postJson($probe['path'], [ednaProbeEvent($probe)])->assertNotFound();
    expect(Cache::get('edna-probe-captures:'.$probe['id']))->toBeNull();
});

test('database cache persists encrypted bodies and supports locked capture and explicit cleanup', function () {
    config()->set('cache.default', 'database');
    $probe = startEdnaProbe();
    $this->artisan('edna:probe', ['action' => 'capture', 'id' => $probe['id']])->assertSuccessful();
    $message = ednaProbeEvent($probe);
    $message['messageContent']['text'] = 'Private diagnostic conversation';
    $this->postJson($probe['path'], [$message], ['X-API-KEY' => 'private-header-secret'])->assertOk();
    $capture = Cache::get('edna-probe-captures:'.$probe['id'])[0];
    expect(Crypt::decryptString($capture['encrypted_body']))->toContain('Private diagnostic conversation')
        ->and(DB::table('cache')->pluck('value')->implode(''))->not->toContain('Private diagnostic conversation', 'private-header-secret', '5493510000000');
    $this->artisan('edna:probe', ['action' => 'stop', 'id' => $probe['id']])->assertSuccessful();
    expect(DB::table('cache')->where('key', 'like', '%'.$probe['id'])->count())->toBe(0)
        ->and(DB::table('cache_locks')->where('key', 'like', '%'.$probe['id'])->count())->toBe(0);
});

test('probe identifies the Token scheme without saving the credential', function () {
    $probe = startEdnaProbe();
    $this->postJson($probe['path'], ednaProbeEvent($probe), ['Authorization' => 'Token sensitive-secret'])->assertOk();
    $result = Cache::get('edna-probe-result:'.$probe['id']);
    expect($result['headers']['authorization'])->toBe('token')
        ->and(json_encode($result))->not->toContain('sensitive-secret');
});
