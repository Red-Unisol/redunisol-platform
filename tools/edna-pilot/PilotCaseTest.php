<?php

use App\Services\EdnaFlowRouter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

uses(TestCase::class, RefreshDatabase::class);
require_once __DIR__.'/EdnaPilotCase.php';

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 9, 18)->setTime(18, 0));
    config(['app.key' => 'base64:'.base64_encode(str_repeat('x', 32)),
        'edna.enabled' => true, 'edna.router_enabled' => true, 'edna.results_enabled' => true,
        'edna.router_recipients' => ['5493510000000'], 'edna.subject_id' => '2423',
        'edna.cascade_id' => '2557', 'edna.api_key' => 'test-only', 'edna.router_start_at' => now()->subDay()->toIso8601String()]);
    Http::preventStrayRequests();
    $scope = (new EdnaFlowRouter)->scope('2423', '5493510000000');
    DB::table('edna_router_contacts')->insert(['scope' => $scope]);
    $this->previous = DB::table('edna_flow_sends')->insertGetId([
        'request_id' => (string) Str::uuid(), 'entry_event_id' => 987, 'scope' => $scope,
        'subject_id' => '2423', 'cascade_id' => '2557', 'flow_id' => EdnaFlowRouter::FLOW_ID,
        'recipient' => Crypt::encryptString('5493510000000'), 'state' => 'completed',
        'entry_received_at' => now()->subHour(), 'created_at' => now()->subHour(),
    ]);
    DB::table('edna_router_results')->insert(['flow_send_id' => $this->previous, 'response_event_id' => 988,
        'province' => 'caba', 'situation' => 'pfa', 'segment' => 'caba_pfa', 'landing_url' => 'https://redunisol.com.ar/',
        'message_text' => 'previous', 'response_received_at' => now()->subHour(), 'request_id' => (string) Str::uuid(),
        'state' => 'confirmed', 'crm_state' => 'synced']);
    $this->payload = ['subscriber' => ['identifier' => '5493510000000'], 'receivedAt' => now()->toIso8601String(),
        'messageContent' => ['type' => 'TEXT', 'text' => 'Hola, vengo del sitio web de Red Unisol. prueba-router-cordoba-jubilado']];
    $this->entry = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423', 'message_id' => '1234',
        'payload' => Crypt::encryptString(json_encode($this->payload)), 'status' => 'delivered', 'outcome' => 'router_entry',
        'router_action' => 'cooldown', 'flow_send_id' => $this->previous]);
});

test('dry-run is read-only and does not release the cooldown', function () {
    expect(EdnaPilotCase::run('cordoba-jubilado', $this->entry))->toMatchArray(['ready' => true, 'created' => false]);
    expect(DB::table('edna_flow_sends')->count())->toBe(1)->and(DB::table('jobs')->count())->toBe(0)
        ->and(DB::table('edna_incoming_events')->find($this->entry)->router_action)->toBe('cooldown');
});

test('apply queues exactly one real Flow and preserves the old ledger and cooldown config', function () {
    $before = (array) DB::table('edna_flow_sends')->find($this->previous);
    $config = config('edna');
    $result = EdnaPilotCase::run('cordoba-jubilado', $this->entry, true);
    expect($result['created'])->toBeTrue();
    expect(EdnaPilotCase::run('cordoba-jubilado', $this->entry, true)['created'])->toBeFalse();
    expect(DB::table('edna_flow_sends')->count())->toBe(2)->and(DB::table('jobs')->count())->toBe(1)
        ->and(DB::table('edna_incoming_events')->find($this->entry)->router_action)->toBe('pilot_scheduled')
        ->and((array) DB::table('edna_flow_sends')->find($this->previous))->toBe($before)->and(config('edna'))->toBe($config);
    expect(DB::table('jobs')->first()->payload)->toContain('SendEdnaFlow')->not->toContain('5493510000000');
    Http::assertNothingSent();
});

test('pilot rejects unsafe configuration unrelated entries and unfinished prior cases', function ($mode) {
    if ($mode === 'all') {
        config(['edna.router_recipients' => []]);
    }
    if ($mode === 'multiple') {
        config(['edna.router_recipients' => ['5493510000000', '5493511111111']]);
    }
    if ($mode === 'disabled') {
        config(['edna.results_enabled' => false]);
    }
    if ($mode === 'channel') {
        config(['edna.subject_id' => '2580']);
    }
    if ($mode === 'cascade') {
        config(['edna.cascade_id' => '9999']);
    }
    if ($mode === 'phone') {
        $this->payload['subscriber']['identifier'] = '5493511111111';
    }
    if ($mode === 'text') {
        $this->payload['messageContent']['text'] = 'unrelated';
    }
    if ($mode === 'type') {
        $this->payload['messageContent']['type'] = 'FLOW';
    }
    if ($mode === 'stale') {
        $this->payload['receivedAt'] = now()->subMinutes(16)->toIso8601String();
    }
    if ($mode === 'future') {
        $this->payload['receivedAt'] = now()->addMinutes(6)->toIso8601String();
    }
    if ($mode === 'unconfirmed') {
        DB::table('edna_flow_sends')->update(['state' => 'unknown']);
    }
    if ($mode === 'landing') {
        DB::table('edna_router_results')->update(['state' => 'pending']);
    }
    if ($mode === 'crm') {
        DB::table('edna_router_results')->update(['crm_state' => 'review']);
    }
    if ($mode === 'pending') {
        DB::table('edna_incoming_events')->update(['status' => 'pending']);
    }
    if ($mode === 'scheduled') {
        DB::table('edna_incoming_events')->update(['router_action' => 'scheduled']);
    }
    DB::table('edna_incoming_events')->where('id', $this->entry)->update(['payload' => Crypt::encryptString(json_encode($this->payload))]);
    expect(fn () => EdnaPilotCase::run('cordoba-jubilado', $this->entry, true))->toThrow(RuntimeException::class);
    expect(DB::table('edna_flow_sends')->count())->toBe(1)->and(DB::table('jobs')->count())->toBe(0);
})->with(['all', 'multiple', 'disabled', 'channel', 'cascade', 'phone', 'text', 'type', 'stale', 'future', 'unconfirmed', 'landing', 'crm', 'pending', 'scheduled']);

test('queue failure rolls back the pilot reservation', function () {
    Queue::shouldReceive('connection')->with('edna')->once()->andThrow(new RuntimeException('failure'));
    expect(fn () => EdnaPilotCase::run('cordoba-jubilado', $this->entry, true))->toThrow(RuntimeException::class);
    expect(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_incoming_events')->find($this->entry)->router_action)->toBe('cooldown');
});

test('unsupported acceptance cases cannot reserve a send', function () {
    expect(fn () => EdnaPilotCase::run('new-case', $this->entry, true))->toThrow(RuntimeException::class);
});
