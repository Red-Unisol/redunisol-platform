<?php

use App\Services\EdnaFreshIntake;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

it('pages only positive post-cutover work and omits dormant applications', function () {
    config(['services.bitrix_routing.allocation_token' => 'test-token']);
    $path = '/api/internal/bitrix-routing/chat-candidates';
    $this->postJson($path, ['channel' => 'web', 'after' => 0])->assertUnauthorized();
    $this->withHeader('Authorization', 'Bearer test-token');
    $this->postJson($path, ['channel' => 'web', 'after' => 0])->assertExactJson(['ids' => [], 'next' => null]);
    DB::table('edna_intake_cutovers')->insert(['name' => EdnaFreshIntake::OWNERSHIP, 'entry_id_after' => 2,
        'starts_at' => now()->subHours(3)]);
    $submission = (string) Str::uuid();
    DB::table('web_form_receipts')->insert(['id' => $submission, 'source' => 'web_server', 'received_at' => now()->subHour(),
        'expires_at' => now()->addDay()]);
    for ($id = 1; $id <= 55; $id++) {
        DB::table('web_form_chat_routes')->insert(['entry_event_id' => $id, 'submission_id' => $submission,
            'deal_id' => $id, 'proof' => json_encode($id === 3 ? [] : ['commercial_readiness' => ['deal_id' => $id]]),
            'state' => $id === 4 ? 'routed' : 'waiting', 'updated_at' => now()]);
    }
    $this->postJson($path, ['channel' => 'web', 'after' => 0])->assertOk()->assertJsonCount(50, 'ids')
        ->assertJsonPath('ids.0', 5)->assertJsonPath('next', 54);
    $this->postJson($path, ['channel' => 'web', 'after' => 54])->assertExactJson(['ids' => [55], 'next' => null]);

    $send = DB::table('edna_flow_sends')->insertGetId(['entry_event_id' => 101, 'entry_received_at' => now()->subHour(),
        'request_id' => (string) Str::uuid(), 'scope' => 'test', 'subject_id' => '1', 'cascade_id' => '2', 'flow_id' => '3']);
    $intake = DB::table('edna_intake_requests')->insertGetId(['flow_send_id' => $send, 'response_event_id' => 102,
        'received_at' => now(), 'lead_id' => '701']);
    DB::table('edna_intake_chat_routes')->insert(['request_id' => $intake, 'state' => 'pending', 'proof' => '{}',
        'assigned_case' => '{}', 'updated_at' => now()]);
    $this->postJson($path, ['channel' => 'v3', 'after' => 0])->assertExactJson(['ids' => [701], 'next' => null]);
    DB::table('edna_intake_chat_routes')->where('request_id', $intake)->update(['state' => 'confirmed']);
    $this->postJson($path, ['channel' => 'v3', 'after' => 0])->assertExactJson(['ids' => [], 'next' => null]);
});
