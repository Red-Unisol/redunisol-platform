<?php

use App\Services\EdnaBitrix;
use App\Services\SalesChatTransfer;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class DeliveryCrmFixture extends EdnaBitrix
{
    public array $transfers = [];

    public int $posts = 0;

    public int $owner = 74827;

    public int $session = 501;

    public int $assignedSeller = 371;

    public bool $taken = false;

    public bool $takeDuringAssignmentCheck = false;

    public bool $loseAck = false;

    public int $sessionOperator = 74827;

    public bool $lateReply = false;

    public int $statsReads = 0;

    public bool $closed = false;

    public bool $bound = true;

    public string $primary = 'LEAD|101';

    public string $bindings = 'DEAL|701';

    public function call(string $method, array $payload = []): mixed
    {
        if ($method === 'imopenlines.operator.transfer') {
            expect($payload)->toBe(['CHAT_ID' => 601, 'USER_ID' => 371]);
            expect(DB::table(SalesChatTransfer::TABLE)->whereNotNull('intent_at')->count())->toBe(1);
            $this->posts++;
            $this->transfers[] = ['chatId' => 601, 'sessionId' => 501, 'initiatorId' => 71283,
                'fromOperatorId' => 71283, 'toOperatorId' => 371, 'fromConfigId' => 1, 'type' => 'USER', 'mode' => 'MANUAL',
                'date' => now()->utc()->toIso8601String()];
            $this->owner = 371;
            if ($this->loseAck) {
                throw new RuntimeException('Simulated response loss after provider commit.');
            }

            return true;
        }
        if ($method === 'crm.item.get') {
            $this->taken = $this->taken || $this->takeDuringAssignmentCheck;

            return ['item' => ['id' => 701, 'leadId' => 101, 'contactId' => 201,
                'assignedById' => $this->assignedSeller, 'stageId' => 'C1:NEW']];
        }

        return match ($method) {
            'imopenlines.dialog.get' => ['id' => 601, 'owner' => $this->owner, 'entity_type' => 'LINES',
                'entity_id' => 'whatsappbyedna|1|5491100000000@2423|99', 'text_field_enabled' => ! $this->closed,
                'entity_data_2' => $this->bindings,
                'entity_data_1' => 'Y|'.$this->primary.'|N|N|'.$this->session.'|'.strtotime('2026-11-24T14:59:00Z')],
            'imopenlines.config.get' => ['ID' => 1, 'QUEUE' => [['ENTITY_TYPE' => 'user', 'ENTITY_ID' => '74827'], ['ENTITY_TYPE' => 'user', 'ENTITY_ID' => '373']]],
            'imopenlines.v2.Session.list' => ['hasNextPage' => false, 'sessions' => [['id' => $this->session, 'chatId' => 601, 'configId' => 1,
                'dateCreate' => '2026-11-24T14:59:00Z', 'source' => 'whatsappbyedna', 'status' => $this->taken ? 'answered' : 'new', 'operatorId' => $this->sessionOperator,
                'dateFirstAnswer' => null, 'dateOperatorAnswer' => $this->taken ? '2026-11-24T15:01:00Z' : null, 'dateClose' => null]]],
            'imopenlines.v2.Session.Stat.get' => ['sessions' => [['sessionId' => 501, 'transfersCount' => count($this->transfers), 'messagesOperatorCount' => $this->lateReply && ++$this->statsReads > 1 ? 1 : 0]]],
            'imopenlines.v2.Session.Transfer.list' => ['transfers' => $this->transfers, 'hasNextPage' => false],
            'imopenlines.session.history.get' => ['chatId' => 601, 'sessionId' => 501, 'hasNextPage' => false, 'users' => [99 => ['connector' => true]],
                'message' => [['id' => 401, 'chatid' => 601, 'senderid' => 99, 'date' => '2026-11-24T14:59:50Z',
                    'params' => ['connectorMid' => ['400']]]]],
            'imopenlines.crm.chat.get' => $this->bound ? [['CHAT_ID' => 601]] : [],
            'crm.lead.get' => ['ID' => 101, 'ASSIGNED_BY_ID' => $this->assignedSeller],
            'user.get' => [['ID' => 371, 'ACTIVE' => true, 'USER_TYPE' => 'employee', 'UF_DEPARTMENT' => [1]]],
            default => throw new LogicException('Unexpected fixture operation '.$method),
        };
    }
}

beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-24T15:00:00Z'));
    config(['edna.api_key' => 'fixture', 'edna.subject_id' => 2423, 'edna.kestra_chat_transfer_delivery_enabled' => true,
        'services.bitrix_routing.allocation_token' => 'fixture-token', 'edna.bitrix_url' => 'https://redunisol.bitrix24.es/rest/71283/fixture']);
    Http::preventStrayRequests();
    $this->crm = new DeliveryCrmFixture;
    app()->instance(EdnaBitrix::class, $this->crm);
    $this->path = '/api/internal/sales-chat/transfer-requests';
    $this->payload = ['scope' => config('chat_response.scope'), 'chat_id' => 601, 'session_id' => 501, 'deal_id' => 701,
        'lead_id' => 101, 'contact_id' => 201, 'target_id' => 371, 'stage_id' => 'C1:NEW'];
    $this->withToken('fixture-token');
});

function deliveryHistoryResponse(): array
{
    return ['hasNext' => false, 'content' => [['direction' => 'IN', 'channelType' => 'WHATSAPP', 'subjectId' => 2423,
        'address' => '5491100000000', 'messageId' => 400, 'content' => ['type' => 'BUTTON'], 'sentOrReceivedAt' => '2026-11-24T14:59:40Z']]];
}

test('a repeatable Edna outage is retried and recovers exactly once or preserves Nico', function (string $scenario) {
    Http::fake(['https://app.edna.io/api/messages/history' => Http::sequence()->push([], 503)->push(deliveryHistoryResponse())]);
    $request = $this->postJson($this->path, $this->payload)->assertStatus(202)->json('request_id');
    $this->postJson($this->path, $this->payload)->assertOk()->assertJsonPath('request_id', $request);
    $this->postJson($this->path, array_merge($this->payload, ['target_id' => 372]))->assertConflict()->assertJsonPath('target_id', 371);
    $this->artisan('sales:chat-transfers')->assertSuccessful();
    $row = DB::table(SalesChatTransfer::TABLE)->sole();
    expect($row->state)->toBe('waiting')->and($row->reason)->toBe('customer_window_unknown')
        ->and($row->intent_at)->toBeNull()->and($this->crm->posts)->toBe(0);
    // A second tick before it is due doesn't call either provider.
    $this->artisan('sales:chat-transfers')->assertSuccessful();
    Http::assertSentCount(1);
    $this->crm->taken = $scenario === 'nico';
    $this->crm->takeDuringAssignmentCheck = $scenario === 'nico_during_last_check';
    if ($scenario === 'nico') {
        $this->crm->assignedSeller = 57; // Kestra never finished the CRM write after Nico took the session.
    }
    $this->travelTo(CarbonImmutable::parse($row->available_at)->addSecond());
    $this->artisan('sales:chat-transfers')->assertSuccessful();
    $this->travel(25)->minutes();
    $this->artisan('sales:chat-transfers')->assertSuccessful();
    Http::assertSentCount(2);
    Http::assertSent(fn (Request $req) => $req['messageId'] === 400 && $req['subjectId'] === 2423 && $req['direction'] === 'IN');
    $row = DB::table(SalesChatTransfer::TABLE)->sole();
    expect((int) $row->unverified_checks)->toBe(1)->and($row->first_unverified_at)->not->toBeNull();
    if ($scenario === 'unattended') {
        expect($row->state)->toBe('confirmed')->and($row->acknowledged)->toBeTruthy()->and(strlen($row->native_event_sha256))->toBe(64)
            ->and($this->crm->posts)->toBe(1)->and($this->crm->transfers)->toHaveCount(1)->and($this->crm->owner)->toBe(371);
    } else {
        expect($row->state)->toBe('preserved')->and($row->reason)->toBe('operator_attention_preserved')
            ->and($row->intent_at)->toBeNull()->and($this->crm->posts)->toBe(0)->and($this->crm->owner)->toBe(74827);
    }
    $this->postJson($this->path, $this->payload)->assertOk()->assertJsonPath('status', $row->state);
})->with(['unattended', 'nico', 'nico_during_last_check']);

test('a historic or unknown binding cannot reserve a reused session ahead of its current case', function () {
    $wrong = array_merge($this->payload, ['lead_id' => 102, 'deal_id' => 702]);
    $this->postJson($this->path, $wrong)->assertUnprocessable()->assertJsonPath('error', 'case_binding_mismatch');
    $this->crm->primary = 'CONTACT|201';
    $this->crm->bindings = 'DEAL|0|LEAD|0';
    $this->postJson($this->path, $this->payload)->assertStatus(503)->assertJsonPath('error', 'case_binding_unverified');
    $this->crm->session = 502;
    $this->postJson($this->path, $this->payload)->assertUnprocessable()->assertJsonPath('error', 'session_closed_or_replaced');
    expect(DB::table(SalesChatTransfer::TABLE)->count())->toBe(0);
    $this->crm->session = 501;
    $this->crm->primary = 'LEAD|101';
    $this->crm->bindings = 'DEAL|701';
    $this->postJson($this->path, $this->payload)->assertStatus(202)->assertJsonPath('deal_id', 701);
    // Already accepted: a replay still recovers the same receipt after the session closes.
    $this->crm->closed = true;
    $this->postJson($this->path, $this->payload)->assertOk()->assertJsonPath('deal_id', 701);
    expect(DB::table(SalesChatTransfer::TABLE)->count())->toBe(1)->and($this->crm->posts)->toBe(0);
});

test('lost acknowledgement only reconciles a native event and never repeats an uncertain POST', function (bool $indexed) {
    Http::fake(['https://app.edna.io/api/messages/history' => Http::response(deliveryHistoryResponse())]);
    $this->crm->loseAck = true;
    $this->postJson($this->path, $this->payload)->assertStatus(202);
    $lease = Cache::lock('web-form-chat:601', 160);
    expect($lease->get())->toBeTrue();
    $this->artisan('sales:chat-transfers')->assertSuccessful();
    expect($this->crm->posts)->toBe(0);
    $lease->release();
    $this->artisan('sales:chat-transfers')->assertSuccessful();
    if (! $indexed) {
        $this->crm->transfers = [];
    }
    $this->travel(2)->minutes();
    $this->artisan('sales:chat-transfers')->assertSuccessful();
    $this->travel(9)->hours();
    $this->artisan('sales:chat-transfers')->assertSuccessful();
    $row = DB::table(SalesChatTransfer::TABLE)->sole();
    expect($row->state)->toBe($indexed ? 'observed' : 'needs_attention')->and($row->acknowledged)->toBeFalsy()
        ->and($this->crm->posts)->toBe(1)->and(SalesChatTransfer::ownsSession(601, 501))->toBeTrue();
    Http::assertSentCount(1);
})->with([true, false]);

test('changed commercial ownership, replacement, expiry or a previous effect never authorize a transfer', function (string $scenario, string $reason) {
    $history = deliveryHistoryResponse();
    if ($scenario === 'expired') {
        $history['content'][0]['sentOrReceivedAt'] = '2026-11-23T12:00:00Z';
    }
    Http::fake(['https://app.edna.io/api/messages/history' => Http::response($history)]);
    $this->postJson($this->path, $this->payload)->assertStatus(202);
    if ($scenario === 'owner') {
        $this->crm->assignedSeller = 372;
    } elseif ($scenario === 'late_operator_reply') {
        $this->crm->lateReply = true;
    } elseif ($scenario === 'assigned_session_operator') {
        $this->crm->sessionOperator = 373;
    } elseif ($scenario === 'new_case') {
        $this->crm->primary = 'LEAD|102';
    } elseif ($scenario === 'new_deal') {
        $this->crm->bindings = 'DEAL|702';
    } elseif ($scenario === 'contact_only') {
        $this->crm->primary = 'CONTACT|201';
        $this->crm->bindings = 'DEAL|0|LEAD|0';
    } elseif ($scenario === 'detached') {
        $this->crm->bound = false;
    } elseif ($scenario === 'replaced') {
        $this->crm->session = 502;
    } elseif ($scenario === 'closed') {
        $this->crm->closed = true;
    } elseif ($scenario === 'prior_intent') {
        DB::table('sales_inbox_sessions')->insert(['chat_id' => 601, 'session_id' => 501, 'opened_at' => now(),
            'state' => 'uncertain', 'channel' => 'whatsappbyedna', 'intent' => json_encode(['action' => 'transfer'])]);
    }
    $this->artisan('sales:chat-transfers')->assertSuccessful();
    expect(DB::table(SalesChatTransfer::TABLE)->value('reason'))->toBe($reason)->and($this->crm->posts)->toBe(0);
})->with([
    ['late_operator_reply', 'operator_message_preserved'], ['assigned_session_operator', 'session_operator_preserved'],
    ['new_case', 'current_session_case_unverified'], ['new_deal', 'current_session_case_unverified'], ['contact_only', 'current_session_case_unverified'],
    ['detached', 'commercial_chat_binding_unverified'], ['owner', 'commercial_assignment_pending_or_changed'], ['replaced', 'customer_window_closed'], ['closed', 'customer_window_closed'],
    ['expired', 'customer_window_expired'], ['prior_intent', 'prior_local_effect_intent'],
]);

test('custody is authenticated and disabled by default; cohort metrics expose unverified windows', function () {
    $this->withToken('different')->postJson($this->path, $this->payload)->assertUnauthorized();
    $this->withToken('fixture-token')->postJson($this->path, array_merge($this->payload, ['scope' => 'different']))->assertForbidden();
    config(['edna.kestra_chat_transfer_delivery_enabled' => false]);
    $this->postJson($this->path, $this->payload)->assertStatus(503);
    expect(DB::table(SalesChatTransfer::TABLE)->count())->toBe(0);
    config(['edna.kestra_chat_transfer_delivery_enabled' => true]);
    Http::fake(['https://app.edna.io/api/messages/history' => Http::response([], 503)]);
    $this->postJson($this->path, $this->payload)->assertStatus(202);
    $this->artisan('sales:chat-transfers')->assertSuccessful();
    expect(Artisan::call('sales:distribution', ['--day' => '2026-11-24']))->toBe(0);
    $metrics = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);
    expect($metrics['current_kestra_delivery_requests_for_opened_sessions'])->toBe([
        ['state' => 'waiting', 'reason' => 'customer_window_unknown', 'requests' => 1, 'requests_ever_unverified' => 1, 'unverified_checks' => 1],
    ])->and($metrics['native_transfer_counts']['automatic'])->toBe(0);
});
