<?php

use App\Services\EdnaBitrix;
use App\Services\SalesTransferWindow;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    $this->travelTo(new DateTimeImmutable('2026-11-24T15:00:00Z'));
    config(['app.key' => 'base64:'.base64_encode(str_repeat('w', 32)), 'edna.subject_id' => '2423', 'edna.api_key' => 'fixture']);
    Http::preventStrayRequests();
});

function salesWindowFixture(): EdnaBitrix
{
    return new class extends EdnaBitrix
    {
        public array $dialog = ['id' => 601, 'entity_type' => 'LINES', 'entity_id' => 'whatsappbyedna|1|5491100000000@2423|99',
            'entity_data_1' => 'Y|LEAD|101|N|N|501|1794400000', 'text_field_enabled' => true];

        public array $history = ['chatId' => 601, 'sessionId' => 501, 'hasNextPage' => false, 'users' => [99 => ['connector' => true], 57 => ['connector' => false]],
            'message' => [
                ['id' => 34, 'chatid' => 601, 'senderid' => 99, 'date' => '2026-11-24T14:59:50Z', 'params' => ['connectorMid' => ['400']]],
                ['id' => 35, 'chatid' => 601, 'senderid' => 57, 'date' => '2026-11-24T14:59:56Z'],
                ['id' => 36, 'chatid' => 601, 'senderid' => 0, 'date' => '2026-11-24T14:59:57Z'],
                ['id' => 37, 'chatid' => 601, 'senderid' => 99, 'date' => '2026-11-24T14:59:58Z', 'params' => ['class' => 'bx-messenger-content-item-ol-output']],
            ]];

        public ?string $closedAt = null;

        public ?array $older = null;

        public function call(string $method, array $payload = []): mixed
        {
            if ($method === 'imopenlines.session.history.get' && $payload === ['SESSION_ID' => 501, 'LIMIT' => 200, 'LAST_ID' => 35, 'LAST_DATE' => strtotime('2026-11-24T14:59:56Z')]) {
                return $this->older;
            }
            if ($method === 'imopenlines.v2.Session.list') {
                return ['hasNextPage' => false, 'sessions' => [['id' => 501, 'chatId' => 601, 'configId' => 1, 'source' => 'whatsappbyedna',
                    'status' => $this->closedAt ? 'closed' : 'new', 'dateClose' => $this->closedAt]]];
            }

            return match ([$method, $payload]) {
                ['imopenlines.dialog.get', ['CHAT_ID' => 601]] => $this->dialog,
                ['imopenlines.session.history.get', ['SESSION_ID' => 501]] => $this->history,
                default => throw new LogicException('Unexpected operation.'),
            };
        }
    };
}

function salesWindowCallback(string $at, string $id = '400', string $type = 'BUTTON'): void
{
    $payload = ['id' => $id, 'subjectId' => '2423', 'subscriber' => ['identifier' => '5491100000000'],
        'receivedAt' => $at, 'messageContent' => ['type' => $type, 'text' => 'fixture']];
    DB::table('edna_incoming_events')->insert(['subject_id' => '2423', 'message_id' => $id,
        'payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR))]);
}

test('WhatsApp decisions use the time of the matched customer inbound, even after a delayed import or operator replies', function ($at, $state) {
    salesWindowCallback($at);
    $window = (new SalesTransferWindow)->inspect(salesWindowFixture(), 601, 501);
    expect($window['state'])->toBe($state);
    if ($state !== 'unknown') {
        Http::assertNothingSent();
    }
})->with([
    ['2026-11-23T12:00:00.000001-03:00', 'open'], ['2026-11-23T12:00:00-03:00', 'expired'],
    ['2026-11-23T14:59:59Z', 'expired'], ['2026-11-24T15:00:01Z', 'unknown'],
    ['2026-11-24T12:00:01', 'unknown'], ['2026-11-31T12:00:01Z', 'unknown'],
]);

test('only the latest matched customer message in this session can renew the evidence', function () {
    $crm = salesWindowFixture();
    salesWindowCallback('2026-11-20T12:00:00Z');
    salesWindowCallback('2026-11-24T14:00:00Z', '880');
    expect((new SalesTransferWindow)->inspect($crm, 601, 501)['state'])->toBe('expired');
    $crm->history['message'][] = ['id' => 45, 'chatid' => 601, 'senderid' => 99, 'date' => '2026-11-24T14:59:59Z', 'params' => ['CONNECTOR_MID' => ['880']]];
    expect((new SalesTransferWindow)->inspect($crm, 601, 501))->toBe(['chat_id' => 601, 'session_id' => 501, 'state' => 'open',
        'expires_at' => '2026-11-25T14:00:00.000000Z']);
    $crm->closedAt = '2026-11-24T14:40:00Z';
    expect((new SalesTransferWindow)->inspect($crm, 601, 501)['state'])->toBe('closed');
    $crm->closedAt = null;
    $crm->dialog['entity_data_1'] = 'Y|LEAD|101|N|N|502|1794400000';
    expect((new SalesTransferWindow)->inspect($crm, 601, 501)['state'])->toBe('closed');
});

test('the read-only provider fallback checks the exact recipient, subject, direction, type, mid and actual time', function ($change, $expected) {
    $message = ['direction' => 'IN', 'address' => '5491100000000', 'subjectId' => 2423, 'messageId' => 400, 'channelType' => 'WHATSAPP',
        'content' => '{"type":"TEXT"}', 'sentOrReceivedAt' => '2026-11-24T14:30:00.201+0000', 'deliveryStatus' => 'SENT'];
    $message = array_replace($message, $change);
    Http::fake(['https://app.edna.io/api/messages/history' => Http::response(['hasNext' => false, 'content' => [$message]])]);
    expect((new SalesTransferWindow)->inspect(salesWindowFixture(), 601, 501)['state'])->toBe($expected);
    Http::assertSent(fn (Request $r) => $r->method() === 'POST' && $r['direction'] === 'IN'
        && $r['messageId'] === 400 && $r['subjectId'] === 2423 && $r['subscriberFilter']['address'] === '5491100000000');
    Http::assertSentCount(1);
})->with([
    [[], 'open'], [['direction' => 'OUT'], 'unknown'], [['subjectId' => 2424], 'unknown'],
    [['address' => '5491100000001'], 'unknown'], [['messageId' => 401], 'unknown'],
    [['content' => '{"type":"READ"}'], 'unknown'], [['sentOrReceivedAt' => null, 'deliveryStatusAt' => '2026-11-24T14:30:00Z'], 'unknown'],
]);

test('an incomplete or misidentified customer history authorizes nothing', function ($scenario) {
    $crm = salesWindowFixture();
    salesWindowCallback('2026-11-24T12:00:00Z');
    match ($scenario) {
        'recipient' => $crm->dialog['entity_id'] = 'whatsappbyedna|1|5491100000001@2423|99',
        'sender' => $crm->dialog['entity_id'] = 'whatsappbyedna|1|5491100000000@2423|98',
        'ambiguous' => $crm->history['message'][0]['params']['connectorMid'][] = '404',
        'truncated' => $crm->history['hasNextPage'] = true,
        'invalid order' => $crm->history['usersMessage']['chat601'] = [34, 35, 36, 37],
        'participant' => $crm->history['users'][99] = [],
        'closing' => $crm->dialog['text_field_enabled'] = 'unknown',
        'another session' => $crm->history['sessionId'] = 502,
    };
    expect((new SalesTransferWindow)->inspect($crm, 601, 501)['state'])->toBe('unknown');
    Http::assertNothingSent();
})->with(['recipient', 'sender', 'ambiguous', 'truncated', 'invalid order', 'participant', 'closing', 'another session']);

test('older pages are read only when the newest native page contains no customer reply', function () {
    $crm = salesWindowFixture();
    salesWindowCallback('2026-11-24T12:00:00Z');
    $crm->older = $crm->history;
    $crm->history['message'] = [$crm->history['message'][1]];
    $crm->history['hasNextPage'] = true;
    $crm->history['nextId'] = 35;
    $crm->history['nextDate'] = strtotime('2026-11-24T14:59:56Z');
    $crm->older['message'] = [$crm->older['message'][0]];
    expect((new SalesTransferWindow)->inspect($crm, 601, 501)['state'])->toBe('open');
    $crm->older = $crm->history;
    expect((new SalesTransferWindow)->inspect($crm, 601, 501)['state'])->toBe('unknown');
});

test('the transport margin is checked using the live clock each time', function () {
    salesWindowCallback('2026-11-23T15:00:08Z');
    $window = (new SalesTransferWindow)->inspect(salesWindowFixture(), 601, 501);
    expect(SalesTransferWindow::blockReason($window))->toBeNull();
    $this->travel(3)->seconds();
    expect(SalesTransferWindow::blockReason($window))->toBe('customer_window_closing');
});

test('the scoped Kestra endpoint reads only the requested chat and session and returns no personal data', function () {
    $url = '/api/internal/sales-chat/transfer-window';
    $data = ['scope' => 'redunisol.dev.marketing-crm', 'chat_id' => 601, 'session_id' => 501];
    config(['services.bitrix_routing.allocation_token' => 'only-tests', 'chat_response.scope' => $data['scope']]);
    app()->instance(EdnaBitrix::class, salesWindowFixture());
    salesWindowCallback('2026-11-24T12:00:00Z');
    $this->postJson($url, $data)->assertUnauthorized();
    $this->withToken('only-tests')->postJson($url, ['scope' => 'redunisol.prod.marketing-crm'] + $data)->assertForbidden();
    $this->withToken('only-tests')->postJson($url, ['chat_id' => 0] + $data)->assertUnprocessable();
    $this->withToken('only-tests')->postJson($url, $data)->assertOk()->assertExactJson([
        'chat_id' => 601, 'session_id' => 501, 'state' => 'open', 'expires_at' => '2026-11-25T12:00:00.000000Z',
    ]);
});

test('local rollout preserves the legacy preflight until activated and never disables the proof on rollback', function () {
    $crm = salesWindowFixture();
    salesWindowCallback('2026-11-22T10:00:00Z');
    $legacy = SalesTransferWindow::forLocalTransfer($crm, 601, 501);
    expect($legacy['state'])->toBe('legacy')->and(SalesTransferWindow::localBlockReason($legacy))->toBeNull();
    // The scoped service and sales inbox can already request strict proof independently.
    expect(SalesTransferWindow::forLocalTransfer($crm, 601, 501, requireWindow: true)['state'])->toBe('expired');
    config(['edna.local_transfer_window_enabled' => true]);
    expect(SalesTransferWindow::localBlockReason($legacy))->toBe('customer_window_unknown');
    config(['edna.local_transfer_window_enabled' => false]);
    $strict = SalesTransferWindow::forLocalTransfer($crm, 601, 501);
    expect(SalesTransferWindow::localBlockReason($strict))->toBe('customer_window_expired');
    Http::assertNothingSent();
});

test('a newly queued Kestra handoff fences a local writer at its last check even during rollback', function () {
    $crm = salesWindowFixture();
    $before = SalesTransferWindow::forLocalTransfer($crm, 601, 501);
    expect(SalesTransferWindow::localBlockReason($before))->toBeNull();
    DB::table('sales_chat_transfer_requests')->insert([
        'scope' => config('chat_response.scope'), 'chat_id' => 601, 'session_id' => 501,
        'deal_id' => 30, 'lead_id' => 20, 'target_id' => 300, 'stage_id' => 'NEW', 'deadline_at' => now()->addHour(),
    ]);
    config(['edna.kestra_chat_transfer_delivery_enabled' => false]);
    expect(SalesTransferWindow::localBlockReason($before))->toBe('kestra_delivery_pending')
        ->and(SalesTransferWindow::forLocalTransfer($crm, 601, 501)['state'])->toBe('delivery_pending')
        ->and(SalesTransferWindow::forLocalTransfer($crm, 601, 502)['state'])->toBe('legacy');
    DB::table('sales_chat_transfer_requests')->update(['state' => 'uncertain', 'intent_at' => now()]);
    expect(SalesTransferWindow::localBlockReason($before))->toBe('kestra_delivery_pending');
    Http::assertNothingSent();
});
