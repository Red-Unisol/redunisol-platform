<?php

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
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
