<?php

use App\Services\AttributionJourney;
use App\Services\EdnaBitrix;
use App\Services\SalesChatReopening;
use App\Support\BitrixSellerRegistry;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Only the network is replaced. Unknown calls (including writes) fail the test. */
class ReopeningBitrixReadFixture extends EdnaBitrix
{
    public array $calls = [];

    public array $dialog;

    public array $previous = ['id' => 322037, 'chatId' => 147203, 'configId' => 1, 'status' => 'closed', 'closeReason' => 'operator',
        'crmEntityType' => 'deal', 'crmEntityId' => 1256649, 'operatorId' => 127337, 'dateCreate' => '2026-11-25T23:43:14+03:00',
        'dateOperatorAnswer' => '2026-11-26T15:04:00+03:00', 'dateFirstAnswer' => '2026-11-26T15:57:52+03:00', 'dateClose' => '2026-11-26T15:58:00+03:00'];

    public array $deal = ['ID' => '1256649', 'LEAD_ID' => '432899', 'CONTACT_ID' => '227851', 'CATEGORY_ID' => '1',
        'STAGE_SEMANTIC_ID' => 'P', 'STAGE_ID' => 'C1:NEW', 'CLOSED' => 'N', 'ASSIGNED_BY_ID' => '127337'];

    public array $extraDeals = [];

    public bool $failing = false;

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = $method;

        return match ($method) {
            'imopenlines.dialog.get' => $this->dialog,
            'imopenlines.v2.Session.list' => ['sessions' => isset($payload['dateCreateFrom']) ||
                CarbonImmutable::parse($this->previous['dateClose'])->betweenIncluded($payload['dateCloseFrom'], $payload['dateCloseTo'])
                ? [$this->previous] : [], 'hasNextPage' => false],
            'crm.activity.get' => ['ID' => '727843', 'ASSOCIATED_ENTITY_ID' => '322037', 'PROVIDER_ID' => 'IMOPENLINES_SESSION',
                'START_TIME' => '2026-11-25T23:43:16+03:00'],
            'crm.deal.get' => $this->failing ? throw new RuntimeException('temporary') : $this->deal,
            'crm.deal.list' => [$this->deal, ...$this->extraDeals],
            default => throw new LogicException('Unexpected external call: '.$method),
        };
    }
}

beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-26T13:23:40Z'));
    config(['edna.subject_id' => '2423', 'app.key' => 'base64:'.base64_encode(str_repeat('k', 32))]);
    $this->mock(BitrixSellerRegistry::class)->shouldReceive('enabledIds')->andReturn([127337, 2222]);
    $this->crm = new ReopeningBitrixReadFixture;
    $epoch = strtotime('2026-11-26T12:59:10Z');
    $this->crm->dialog = ['id' => 147203, 'owner' => 74827, 'entity_type' => 'LINES', 'text_field_enabled' => true,
        'entity_id' => 'whatsappbyedna|1|5493510000000@2423|999', 'entity_data_1' => "Y|DEAL|1256649|N|N|322235|$epoch|0|0|0",
        'entity_data_2' => 'LEAD|0|COMPANY|0|CONTACT|227851|DEAL|1256649'];
    $this->entry = (object) ['id' => 46435, 'subject_id' => '2423', 'message_id' => '21152017001'];
    $this->payload = ['id' => $this->entry->message_id, 'subjectId' => $this->entry->subject_id, 'receivedAt' => '2026-11-26T13:23:27Z',
        'subscriber' => ['identifier' => '5493510000000'], 'messageContent' => ['type' => 'TEXT', 'text' => 'Quiero consultar mi solicitud']];
    $this->proof = ['source' => 'bitrix_openline_session', 'evidence' => 'external_message_id', 'verified' => true, 'entry_event_id' => 46435,
        'entry_message_id' => $this->entry->message_id, 'session_id' => '322235', 'chat_id' => '147203', 'message_id' => '7170367', 'activity_id' => '728621'];
    $hash = (new AttributionJourney)->phoneHash('5493510000000');
    $submission = (string) Str::uuid();
    DB::table('web_form_receipts')->insert(['id' => $submission, 'phone_hash' => $hash, 'source' => 'web_server', 'state' => 'synced',
        'lead_id' => '432899', 'contact_id' => '227851', 'received_at' => now()->subDay(), 'expires_at' => now()]);
    DB::table('web_form_chat_routes')->insert(['entry_event_id' => 46075, 'phone_hash' => $hash, 'submission_id' => $submission,
        'deal_id' => '1256649', 'seller_id' => '127337', 'state' => 'routed', 'transfer_state' => 'not_needed', 'proof' => json_encode([
            'verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id', 'chat_id' => '147203',
            'session_id' => '322037', 'message_id' => '7165451', 'activity_id' => '727843', 'entry_event_id' => 46075, 'entry_message_id' => '21143239001'])]);
    $this->router = new SalesChatReopening($this->crm);
});

test('147203 suppresses the immediate decline and resumes only on the explicit later status request with the current seller', function () {
    $decline = $this->payload;
    $decline['messageContent']['text'] = 'Hoy no';
    $decline['receivedAt'] = '2026-11-26T12:59:07Z'; // Edna preceded the native opening by three seconds.
    $decline['id'] = '21151730701';
    $entry = (object) ['id' => 46374, 'subject_id' => '2423', 'message_id' => $decline['id']];
    $proof = array_replace($this->proof, ['entry_event_id' => $entry->id, 'entry_message_id' => $entry->message_id, 'message_id' => '7169823']);
    expect($this->router->decide($entry, $decline, $proof)['reason'])->toBe('reopening_short_decline');
    $this->crm->previous['closeReason'] = 'timeout';
    expect($this->router->decide($entry, $decline, $proof))->toBeNull();
    $decision = $this->router->decide($this->entry, $this->payload, $this->proof);
    expect($decision)->toMatchArray(['action' => 'route', 'seller_id' => '127337', 'deal_id' => '1256649', 'previous_session_id' => '322037']);
    expect($this->router->matchesDestinationDialog($decision, $this->crm->dialog, $this->proof))->toBeTrue();
    $this->crm->deal['ASSIGNED_BY_ID'] = '2222';
    expect($this->router->decide($this->entry, $this->payload, $this->proof)['seller_id'])->toBe('2222');
});

test('a change of native primary, bindings, session or subscriber blocks the final handoff', function (string $field, string $new) {
    $decision = $this->router->decide($this->entry, $this->payload, $this->proof);
    $this->crm->dialog[$field] = $new;
    expect($this->router->matchesDestinationDialog($decision, $this->crm->dialog, $this->proof))->toBeFalse();
})->with([
    ['entity_data_1', 'Y|DEAL|8|N|N|322235|1795697950|0|0|0'],
    ['entity_data_2', 'LEAD|0|COMPANY|0|CONTACT|55|DEAL|1256649'],
    ['entity_data_1', 'Y|DEAL|1256649|N|N|322236|1795697950|0|0|0'],
    ['entity_id', 'whatsappbyedna|1|5493510000001@2423|999'],
]);

test('ambiguous destinations ask for clarification and the same live seller can take the chat across two open loans', function () {
    $this->crm->extraDeals = [array_replace($this->crm->deal, ['ID' => '8', 'ASSIGNED_BY_ID' => '2222'])];
    expect($this->router->decide($this->entry, $this->payload, $this->proof)['action'])->toBe('clarify');
    $this->crm->extraDeals[0]['ASSIGNED_BY_ID'] = '127337';
    expect($this->router->decide($this->entry, $this->payload, $this->proof)['seller_id'])->toBe('127337');
});

test('older explicit reopens probe only a known historical session and retry if Bitrix temporarily fails', function () {
    $this->crm->previous['dateClose'] = '2026-11-26T15:35:00+03:00';
    $this->crm->previous['dateFirstAnswer'] = '2026-11-26T15:30:00+03:00';
    $this->crm->failing = true;
    expect($this->router->decide($this->entry, $this->payload, $this->proof)['action'])->toBe('retry');
    $this->crm->failing = false;
    expect($this->router->decide($this->entry, $this->payload, $this->proof)['seller_id'])->toBe('127337')
        ->and($this->crm->calls)->toContain('crm.activity.get');
    $this->crm->deal['ASSIGNED_BY_ID'] = '74827';
    expect($this->router->decide($this->entry, $this->payload, $this->proof)['reason'])->toBe('reopening_waiting_current_seller');
});

test('a new inbound starts a new WhatsApp window even when the proved earlier loan session closed more than a day ago', function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-30T13:23:40Z'));
    $epoch = strtotime('2026-11-30T12:59:10Z');
    $this->crm->dialog['entity_data_1'] = "Y|DEAL|1256649|N|N|322235|$epoch|0|0|0";
    $this->payload['receivedAt'] = '2026-11-30T13:23:27Z';
    expect($this->router->decide($this->entry, $this->payload, $this->proof)['seller_id'])->toBe('127337');
});

test('new intent, links, ads and campaign replies keep their own route without CRM calls', function (array $patch) {
    $payload = array_replace_recursive($this->payload, $patch);
    expect($this->router->decide($this->entry, $payload, $this->proof))->toBeNull()->and($this->crm->calls)->toBe([]);
})->with([
    [['messageContent' => ['text' => 'Quiero pedir un préstamo nuevo']]],
    [['messageContent' => ['text' => 'Mi solicitud de baja']]],
    [['messageContent' => ['text' => 'Consultar mi solicitud (solicitud: x)']]],
    [['messageContent' => ['referral' => ['source_type' => 'ad']]]],
    [['messageContent' => ['type' => 'BUTTON']]],
    [['replyOutMessageId' => '123']],
]);

test('closed, rejected, unattended, different or expired sessions never yield a route', function (string $situation) {
    match ($situation) {
        'closed' => $this->crm->deal['CLOSED'] = 'Y',
        'rejected' => $this->crm->deal['STAGE_ID'] = 'C1:5',
        'unattended' => $this->crm->previous['dateFirstAnswer'] = null,
        'other_chat' => $this->crm->previous['chatId'] = 1,
        'expired' => $this->travel(25)->hours(),
        'different_case' => $this->crm->dialog['entity_data_2'] = 'LEAD|0|COMPANY|0|CONTACT|8|DEAL|1256649',
    };
    $result = $this->router->decide($this->entry, $this->payload, $this->proof);
    expect($result['action'] ?? null)->not->toBe('route');
})->with(['closed', 'rejected', 'unattended', 'other_chat', 'expired', 'different_case']);
