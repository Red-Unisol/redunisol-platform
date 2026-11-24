<?php

use App\Services\EdnaApi;
use App\Services\EdnaBitrix;
use App\Services\EdnaOrganicAttention;
use App\Services\SalesCampaignReply;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

function campaignFixture(string $primary = 'contact'): array
{
    config(['app.key' => 'synthetic-signing-key', 'edna.subject_id' => '22', 'edna.cascade_id' => '33', 'edna.api_key' => 'fake']);
    $time = CarbonImmutable::parse('2026-11-24T10:00:00Z');
    test()->travelTo($time->addMinute());
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
    $id = $primary === 'lead' ? '19' : '18';
    $attention->shouldReceive('snapshot')->andReturn(['dialog_tuple' => ['primary_entity' => $primary, 'primary_id' => $id,
        'bindings' => [$primary => $id], 'chat_id' => '60', 'session_id' => '50', 'session_epoch' => $time->timestamp,
        'source_hash' => hash_hmac('sha256', 'organic-source:whatsappbyedna|1|origin|abc', 'synthetic-signing-key')]]);
    $deal = ['ID' => '17', 'CONTACT_ID' => '18', 'LEAD_ID' => '19', 'STAGE_SEMANTIC_ID' => 'P', 'STAGE_ID' => 'C1:NEW', 'CATEGORY_ID' => '1', 'ASSIGNED_BY_ID' => '22'];
    $crm = new class($deal, $primary) extends EdnaBitrix
    {
        public array $deals;

        public function __construct(array $deal, public string $primary)
        {
            $this->deals = [$deal];
        }

        public function call(string $method, array $payload = []): mixed
        {
            return match ($method) {
                'crm.deal.list' => $this->deals,
                'crm.activity.get' => ['ID' => 90, 'OWNER_TYPE_ID' => $this->primary === 'lead' ? 1 : 3,
                    'OWNER_ID' => $this->primary === 'lead' ? 19 : 18, 'PROVIDER_ID' => 'IMOPENLINES_SESSION',
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

test('a missing callback can resume only an eligible deal and its native activity for an explicit loan request', function (bool $mismatchedActivity, string $stage) {
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
        'STAGE_SEMANTIC_ID' => 'P', 'STAGE_ID' => $stage, 'ASSIGNED_BY_ID' => 33]]);
    $crm->shouldReceive('call')->with('crm.activity.get', Mockery::any())->andReturn(['ID' => 90, 'OWNER_TYPE_ID' => 2, 'OWNER_ID' => 17,
        'PROVIDER_ID' => 'IMOPENLINES_SESSION', 'ASSOCIATED_ENTITY_ID' => $mismatchedActivity ? 48 : 50, 'PROVIDER_PARAMS' => ['USER_CODE' => $code]]);
    $service = new SalesCampaignReply($crm, Mockery::mock(EdnaOrganicAttention::class), new EdnaApi);
    $decision = $service->directNative($row, $history, ['message_id' => 92]);
    if ($mismatchedActivity) {
        expect($decision)->toBeNull();
    } elseif ($stage === 'C1:KESTRA_REVIEW') {
        expect($decision)->toBe(['state' => 'needs_attention', 'reason' => 'commercial_management_requires_review']);
    } elseif ($stage === 'C1:KESTRA_PENDING') {
        expect($decision)->toBe(['state' => 'waiting', 'reason' => 'commercial_seller_pending']);
    } else {
        expect($decision)->toMatchArray(['target_id' => 33, 'deal_id' => 17, 'reason' => 'native_repeat_loan_request']);
    }
    $history['message'][0]['text'] = 'Sí, quiero asesoramiento';
    expect($service->directNative($row, $history, ['message_id' => 92]))->toBeNull();
})->with([[true, 'C1:NEW'], [false, 'C1:NEW'], [false, 'C1:KESTRA_REVIEW'], [false, 'C1:KESTRA_PENDING']]);

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

test('a verified template reserves the exact native lead before conversion and pins the first deal until delivery', function () {
    [$service, $crm, $proof, $payload, $outgoing] = campaignFixture('lead');
    $proof['native_lead_id'] = '19';
    $deal = $crm->deals[0];
    $crm->deals = [];
    Http::fake(['*/messages/history' => Http::response(['hasNext' => false, 'content' => [$outgoing]])]);
    expect($service->reserve($payload, $proof))->toBeTrue();
    $row = DB::table('sales_inbox_sessions')->first();
    expect(json_decode($row->campaign, true)['waiting_lead']['id'])->toBe('19')
        ->and($service->decision($row, ['message_id' => '92'])['reason'])->toBe('commercial_deal_pending');
    $crm->primary = 'contact'; // another activity owner cannot stand in for the native lead
    expect($service->decision($row, ['message_id' => '92'])['reason'])->toBe('commercial_deal_changed');
    $crm->primary = 'lead';
    $crm->deals = [array_replace($deal, ['LEAD_ID' => '88'])];
    expect($service->decision($row, ['message_id' => '92'])['reason'])->toBe('commercial_deal_changed');
    $crm->deals = [array_replace($deal, ['STAGE_ID' => 'C1:KESTRA_QUEUE'])];
    expect($service->decision($row, ['message_id' => '92'])['reason'])->toBe('commercial_seller_pending')
        ->and(json_decode(DB::table('sales_inbox_sessions')->value('campaign'), true)['deal_id'])->toBe(17);
    $crm->deals = [$deal];
    expect($service->decision($row, ['message_id' => '92']))->toMatchArray(['action' => 'transfer', 'deal_id' => 17, 'target_id' => 22]);
    $crm->deals = [array_replace($deal, ['ID' => '55'])];
    expect($service->decision($row, ['message_id' => '92'])['reason'])->toBe('commercial_deal_changed');
});

test('a missing deal cannot reserve a wrong template or a lead owned by a different native activity', function (string $scenario) {
    [$service, $crm, $proof, $payload, $outgoing] = campaignFixture('lead');
    $crm->deals = [];
    if ($scenario === 'template') {
        $outgoing['matcherId'] = 999;
    } else {
        $crm->primary = 'contact';
    }
    Http::fake(['*/messages/history' => Http::response(['hasNext' => false, 'content' => [$outgoing]])]);
    expect($service->reserve($payload, $proof))->toBeFalse()->and(DB::table('sales_inbox_sessions')->count())->toBe(0);
})->with(['template', 'activity']);

test('only plain compatible later messages preserve the original verified request', function (string $scenario) {
    [$service, $crm, $proof, $payload, $outgoing] = campaignFixture();
    Http::fake(['*/messages/history' => Http::response(['hasNext' => false, 'content' => [$outgoing]])]);
    expect($service->reserve($payload, $proof))->toBeTrue();
    $row = DB::table('sales_inbox_sessions')->first();
    $history = ['sessionId' => 50, 'chatId' => 60, 'hasNextPage' => false, 'users' => [99 => ['connector' => true], 12 => ['connector' => false]],
        'message' => [['id' => 92, 'senderid' => 99, 'params' => ['connectorMid' => ['200']]],
            ['id' => 93, 'senderid' => 99, 'text' => 'Gracias!', 'params' => ['connectorMid' => ['201']]]]];
    switch ($scenario) {
        case 'original missing': unset($history['message'][0]); break;
        case 'edited evidence': $history['message'][0]['params']['connectorMid'] = ['300']; break;
        case 'change': $history['message'][1]['text'] = 'Otra consulta'; break;
        case 'decline then thanks': $history['message'][1]['text'] = 'No, gracias'; $history['message'][] =
            ['id' => 94, 'senderid' => 99, 'text' => 'Gracias', 'params' => ['connectorMid' => ['202']]]; break;
        case 'omitted page': $history['hasNextPage'] = true; break;
        case 'operator': $history['message'][1]['senderid'] = 12; break;
        case 'quoted': $history['message'][1]['params']['reply'] = '1'; break;
    }
    $latest = ['reason' => 'customer_request', 'message_id' => $scenario === 'decline then thanks' ? 94 : 93];
    $decision = $service->decision($row, $latest, $history);
    expect($decision['reason'])->toBe($scenario === 'thanks' ? 'verified_recontact_consent' : 'commercial_reply_superseded');
    if ($scenario === 'thanks') {
        expect($decision)->toMatchArray(['target_id' => 22, 'message_id' => 93]);
    }
})->with(['thanks', 'change', 'decline then thanks', 'operator', 'quoted', 'edited evidence', 'original missing', 'omitted page']);

test('a blocked commercial stage never dispatches to its incidental owner', function (string $stage, string $reason) {
    [$service, $crm, $proof, $payload, $outgoing] = campaignFixture();
    $crm->deals[0]['STAGE_ID'] = $stage;
    Http::fake(['*/messages/history' => Http::response(['hasNext' => false, 'content' => [$outgoing]])]);
    expect($service->reserve($payload, $proof))->toBeTrue();
    expect($service->decision(DB::table('sales_inbox_sessions')->first(), ['message_id' => '92'])['reason'])->toBe($reason);
})->with([['C1:KESTRA_QUEUE', 'commercial_seller_pending'], ['C1:KESTRA_ROUTE_REVIEW', 'commercial_management_requires_review'],
    ['C1:UC_ZH5DGU', 'commercial_management_requires_review']]);

test('a new verified reply can renew an ended window, while old callbacks and uncertain effects keep their receipt', function (string $scenario) {
    [$service, $crm, $proof, $payload, $outgoing] = campaignFixture();
    Http::fake(['*/messages/history' => Http::response(['hasNext' => false, 'content' => [$outgoing]])]);
    expect($service->reserve($payload, $proof))->toBeTrue();
    $q = DB::table('sales_inbox_sessions')->where('session_id', 50);
    $q->update(['state' => 'expired', 'reason' => 'customer_window_expired', 'intent' => $scenario === 'uncertain' ? '{"target_id":22}' : null]);
    $before = $q->value('campaign');
    if ($scenario !== 'same') {
        $proof['entry_message_id'] = $payload['id'] = '201';
        $proof['entry_event_id'] = 5;
        $proof['message_id'] = '94';
        $payload['receivedAt'] = now()->utc()->toIso8601String();
    }
    if ($scenario === 'other deal') {
        $crm->deals[0]['ID'] = '28';
    } elseif ($scenario === 'other chat') {
        $proof['chat_id'] = '61';
    }
    $service->reserve($payload, $proof, resumeOnly: true);
    $row = $q->first();
    if ($scenario === 'new') {
        $stored = json_decode($row->campaign, true);
        expect($row->state)->toBe('pending')->and($stored['proof']['message_id'])->toBe('94')
            ->and($stored['superseded'][0]['reservation']['proof']['message_id'])->toBe('92');
    } else {
        expect($row->state)->toBe('expired')->and($row->campaign)->toBe($before);
    }
})->with(['new', 'same', 'uncertain', 'other deal', 'other chat']);
