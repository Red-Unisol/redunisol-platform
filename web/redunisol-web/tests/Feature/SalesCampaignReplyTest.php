<?php

use App\Services\EdnaApi;
use App\Services\EdnaBitrix;
use App\Services\EdnaOrganicAttention;
use App\Services\SalesCampaignReply;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

function campaignFixture(): array
{
    config(['app.key' => 'synthetic-signing-key', 'edna.subject_id' => '22', 'edna.cascade_id' => '33', 'edna.api_key' => 'fake']);
    $time = CarbonImmutable::parse('2026-11-24T10:00:00Z');
    DB::table('sales_inbox_cursors')->insert(['line_id' => 1, 'starts_at' => $time->subDay(), 'scanned_until' => $time]);
    $payload = ['id' => '200', 'subjectId' => '22', 'subscriber' => ['identifier' => '5491100000000'],
        'receivedAt' => $time->toIso8601String(), 'replyOutMessageId' => '123', 'messageContent' => [
            'type' => 'BUTTON', 'text' => 'Sí, quiero asesoramiento', 'payload' => 'consentir']];
    $proof = ['verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id', 'message_id' => '92',
        'entry_event_id' => 4, 'entry_message_id' => '200', 'activity_id' => '90', 'session_id' => '50', 'chat_id' => '60'];
    $message = ['messageId' => 123, 'matcherId' => 58749, 'matcherName' => 'reingreso_consent', 'direction' => 'OUT',
        'channelType' => 'WHATSAPP', 'subjectId' => 22, 'cascadeId' => 33, 'address' => '5491100000000', 'deliveryStatus' => 'READ',
        'sentOrReceivedAt' => $time->subMinutes(6)->toIso8601String(), 'content' => ['keyboard' => ['rows' => [
            ['buttons' => [['text' => 'Sí, quiero asesoramiento', 'payload' => 'consentir']]]]]]];
    $attention = Mockery::mock(EdnaOrganicAttention::class);
    $attention->shouldReceive('snapshot')->andReturn(['dialog_tuple' => ['primary_entity' => 'contact', 'primary_id' => '18',
        'bindings' => ['contact' => '18'], 'chat_id' => '60', 'session_id' => '50', 'session_epoch' => $time->timestamp,
        'source_hash' => hash_hmac('sha256', 'organic-source:whatsappbyedna|1|origin|abc', 'synthetic-signing-key')]]);
    $deal = ['ID' => '17', 'CONTACT_ID' => '18', 'LEAD_ID' => '19', 'STAGE_SEMANTIC_ID' => 'P', 'CATEGORY_ID' => '1', 'ASSIGNED_BY_ID' => '22'];
    $crm = new class($deal) extends EdnaBitrix
    {
        public array $deals;

        public function __construct(array $deal)
        {
            $this->deals = [$deal];
        }

        public function call(string $method, array $payload = []): mixed
        {
            return match ($method) {
                'crm.deal.list' => $this->deals,
                'crm.activity.get' => ['ID' => 90, 'OWNER_TYPE_ID' => 3, 'OWNER_ID' => 18, 'PROVIDER_ID' => 'IMOPENLINES_SESSION',
                    'ASSOCIATED_ENTITY_ID' => 50, 'PROVIDER_PARAMS' => ['USER_CODE' => 'whatsappbyedna|1|origin|abc']],
                default => throw new LogicException('Unplanned activity.'),
            };
        }
    };

    return [new SalesCampaignReply($crm, $attention, new EdnaApi), $crm, $proof, $payload, $message];
}

test('a contact without open deals enters loan intake only on an explicit authenticated loan request', function () {
    [$service, $crm, $proof, $payload, $outgoing] = campaignFixture();
    $crm->deals = [];
    Http::fake(['*/messages/history' => Http::response(['hasNext' => false, 'content' => [$outgoing]])]);
    expect($service->reserve($payload, $proof))->toBeFalse();
    $payload['messageContent'] = ['type' => 'TEXT', 'text' => 'Quiero solicitar un préstamo'];
    unset($payload['replyOutMessageId']);
    expect($service->reserve($payload, $proof))->toBe(['loan_contact' => '18'])
        ->and(DB::table('sales_inbox_sessions')->count())->toBe(0);
    $payload['messageContent']['text'] = 'Quiero solicitar un préstamo pero no ahora';
    expect($service->reserve($payload, $proof))->toBeFalse();
});

test('a missing callback can resume only the native deal activity of an explicit loan request', function (bool $mismatchedActivity) {
    config(['edna.subject_id' => '22', 'app.key' => 'synthetic-signing-key']);
    $row = (object) ['chat_id' => 60, 'session_id' => 50];
    $history = ['users' => [99 => ['connector' => true]], 'message' => [['senderid' => 99, 'id' => 92, 'text' => 'Quiero solicitar un préstamo',
        'params' => ['connectorMid' => ['200']]]]];
    $crm = Mockery::mock(EdnaBitrix::class);
    $code = 'whatsappbyedna|1|5491100000000@22|300';
    $crm->shouldReceive('call')->with('imopenlines.dialog.get', Mockery::any())->andReturn(['id' => 60, 'entity_type' => 'LINES',
        'entity_id' => $code, 'entity_data_1' => 'Y|DEAL|17|N|N|50|1795600000', 'entity_data_2' => 'CONTACT|18|DEAL|17']);
    $crm->shouldReceive('call')->with('crm.activity.list', Mockery::any())->andReturn([['ID' => 90]]);
    $crm->shouldReceive('call')->with('crm.deal.list', Mockery::any())->andReturn([['ID' => 17, 'CONTACT_ID' => 18, 'CATEGORY_ID' => 1,
        'STAGE_SEMANTIC_ID' => 'P', 'ASSIGNED_BY_ID' => 33]]);
    $crm->shouldReceive('call')->with('crm.activity.get', Mockery::any())->andReturn(['ID' => 90, 'OWNER_TYPE_ID' => 2, 'OWNER_ID' => 17,
        'PROVIDER_ID' => 'IMOPENLINES_SESSION', 'ASSOCIATED_ENTITY_ID' => $mismatchedActivity ? 48 : 50, 'PROVIDER_PARAMS' => ['USER_CODE' => $code]]);
    $service = new SalesCampaignReply($crm, Mockery::mock(EdnaOrganicAttention::class), new EdnaApi);
    $decision = $service->directNative($row, $history, ['message_id' => 92]);
    if ($mismatchedActivity) {
        expect($decision)->toBeNull();
    } else {
        expect($decision)->toMatchArray(['target_id' => 33, 'deal_id' => 17, 'reason' => 'native_repeat_loan_request']);
    }
    $history['message'][0]['text'] = 'Sí, quiero asesoramiento';
    expect($service->directNative($row, $history, ['message_id' => 92]))->toBeNull();
})->with([[true], [false]]);

test('recontact handoff requires a delivered matching template and a unique linked case', function (string $variation) {
    [$service, $crm, $proof, $payload, $outgoing] = campaignFixture();
    switch ($variation) {
        case 'different template': $outgoing['matcherId'] = 11;
            break;
        case 'different answer': $outgoing['content']['keyboard']['rows'][0]['buttons'][0]['payload'] = 'stop';
            break;
        case 'wrong recipient': $outgoing['address'] = '5491122222222';
            break;
        case 'other pipeline': $crm->deals[0]['CATEGORY_ID'] = '15';
            break;
        case 'ambiguous': $crm->deals[] = $crm->deals[0];
            break;
        case 'not delivered': $outgoing['deliveryStatus'] = 'FAILED';
            break;
    }
    Http::fake(['*/messages/history' => Http::response(['hasNext' => false, 'content' => [$outgoing]])]);
    expect($service->reserve($payload, $proof))->toBe($variation === 'verified');
    $row = DB::table('sales_inbox_sessions')->first();
    if ($variation !== 'verified') {
        expect($row)->toBeNull();

        return;
    }
    expect($service->decision($row, ['message_id' => '92']))->toMatchArray(['action' => 'transfer', 'target_id' => 22, 'deal_id' => 17]);
    $crm->deals[0]['ASSIGNED_BY_ID'] = '57';
    expect($service->decision($row, ['message_id' => '92'])['reason'])->toBe('commercial_seller_pending')
        ->and($service->decision($row, ['message_id' => '93'])['reason'])->toBe('commercial_reply_superseded');
})->with(['verified', 'different template', 'different answer', 'wrong recipient', 'other pipeline', 'ambiguous', 'not delivered']);
