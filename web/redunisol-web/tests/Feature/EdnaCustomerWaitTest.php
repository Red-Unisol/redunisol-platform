<?php

use App\Services\EdnaCustomerWait;
use App\Services\EdnaFlowDelivery;
use App\Services\EdnaOrganicTransport;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

it('expires only the verified unanswered customer prompt after 24 hours and actual delivery', function (
    string $status, int $hours, int $messageId, bool $choice, bool $observedPreviously, bool $expected
) {
    config(['edna.subject_id' => '10']);
    $sent = now()->subHours($hours);
    $proof = ['verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'message_id' => 41, 'chat_id' => 51, 'session_id' => 61];
    DB::table('edna_organic_menus')->insert(['request_id' => (string) Str::uuid(), 'entry_event_id' => 1,
        'subject_id' => '10', 'cascade_id' => '8', 'phone_hash' => 'fake', 'recipient' => 'fake', 'chat_id' => 51,
        'session_id' => 61, 'proof' => json_encode($proof), 'state' => 'awaiting_choice', 'send_state' => 'confirmed',
        'entry_received_at' => $sent, 'expires_at' => $sent->copy()->addDay(), 'confirmed_at' => $sent,
        'outgoing_message_id' => '1234', 'choice_event_id' => $choice ? 2 : null]);
    if ($observedPreviously) {
        DB::table('edna_customer_delivery_observations')->insert(['subject_id' => '10',
            'outgoing_message_id' => '1234', 'first_observed_at' => $sent]);
    }
    $transport = Mockery::mock(EdnaOrganicTransport::class);
    $transport->shouldReceive('deliveryEvidence')->atMost()->once()->andReturn(['delivery_status' => $status, 'outgoing_message_id' => '1234']);
    app()->instance(EdnaOrganicTransport::class, $transport);
    expect((new EdnaCustomerWait)->expired(61, 51, $sent->toIso8601String(), $messageId))->toBe($expected);
})->with([
    ['DELIVERED', 25, 41, false, true, true],
    ['DELIVERED', 25, 41, false, false, false],
    ['SENT', 25, 41, false, true, false],
    ['READ', 23, 41, false, true, false],
    ['READ', 25, 42, false, true, false],
    ['READ', 25, 41, true, true, false],
]);

it('recognizes an abandoned v3 only for its own delivered flow, authenticated choice and session', function (bool $differentEntry, bool $answered, bool $expected) {
    config(['edna.subject_id' => '10', 'edna.cascade_id' => '8', 'edna.intake_flow_id' => '99']);
    $sent = now()->subHours(25);
    $request = (string) Str::uuid();
    $proof = ['verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'message_id' => 41, 'chat_id' => 51, 'session_id' => 61];
    $send = DB::table('edna_flow_sends')->insertGetId(['entry_event_id' => $differentEntry ? 12 : 1,
        'request_id' => (string) Str::uuid(), 'scope' => hash_hmac('sha256', 'organic-menu:'.$request, config('app.key')),
        'state' => 'confirmed', 'flow_id' => '99', 'subject_id' => '10', 'cascade_id' => '8',
        'accepted_at' => $sent, 'entry_received_at' => $sent, 'outgoing_message_id' => '112',
        'response_event_id' => $answered ? 7 : null]);
    DB::table('edna_organic_menus')->insert(['request_id' => $request, 'entry_event_id' => 1,
        'subject_id' => '10', 'cascade_id' => '8', 'phone_hash' => 'fake', 'recipient' => 'fake', 'chat_id' => 51,
        'session_id' => 61, 'proof' => json_encode(['choice_proof' => $proof]), 'state' => 'flow_scheduled', 'send_state' => 'confirmed',
        'entry_received_at' => $sent, 'expires_at' => $sent->copy()->addDay(), 'confirmed_at' => $sent,
        'outgoing_message_id' => '1234', 'choice_event_id' => 2, 'choice' => 'loan', 'flow_send_id' => $send]);
    DB::table('edna_customer_delivery_observations')->insert(['subject_id' => '10',
        'outgoing_message_id' => '112', 'first_observed_at' => $sent]);
    $delivery = Mockery::mock(EdnaFlowDelivery::class);
    $delivery->shouldReceive('evidence')->atMost()->once()->andReturn(['delivery_status' => 'DELIVERED', 'outgoing_message_id' => '112']);
    app()->instance(EdnaFlowDelivery::class, $delivery);
    expect((new EdnaCustomerWait)->expired(61, 51, $sent->toIso8601String(), 41))->toBe($expected);
})->with([[false, false, true], [true, false, false], [false, true, false]]);
