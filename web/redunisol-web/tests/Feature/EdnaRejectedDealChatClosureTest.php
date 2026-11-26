<?php

use App\Services\EdnaBitrix;
use App\Services\EdnaRejectedChatClosure;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

class RejectedDealSessionCrm extends EdnaBitrix
{
    public array $responses;

    public int $closeCalls = 0;

    public ?Closure $beforeCall = null;

    public function __construct()
    {
        $sessionTime = now()->subMinutes(10);
        $rejectedAt = now()->subMinutes(5);
        $catalog = json_decode(file_get_contents(resource_path('crm/rejection-notices.json')), true, flags: JSON_THROW_ON_ERROR);
        $template = collect($catalog['notices'])->sole('reason_label', 'SIT NEG BCRA')['text'];
        $deal = ['ID' => '1256777', 'LEAD_ID' => '433111', 'CONTACT_ID' => '234025', 'CATEGORY_ID' => '1',
            'CLOSED' => 'Y', 'STAGE_ID' => 'C1:5', 'STAGE_SEMANTIC_ID' => 'F', 'ASSIGNED_BY_ID' => '57',
            'DATE_CREATE' => now()->subMinutes(6)->toIso8601String(), 'MOVED_TIME' => $rejectedAt->toIso8601String()];
        $this->responses = [
            'crm.lead.list' => [],
            'crm.lead.get' => ['ID' => '433111', 'CONTACT_ID' => '234025', 'STATUS_ID' => 'CONVERTED',
                'ASSIGNED_BY_ID' => '57', 'DATE_CREATE' => now()->subMinutes(7)->toIso8601String()],
            'crm.deal.get' => $deal, 'crm.deal.list' => [$deal],
            'crm.activity.get' => ['ID' => '728209', 'OWNER_TYPE_ID' => '2', 'OWNER_ID' => '1256777',
                'PROVIDER_ID' => 'IMOPENLINES_SESSION', 'ASSOCIATED_ENTITY_ID' => '322143'],
            'imopenlines.dialog.get' => ['id' => 147259, 'entity_type' => 'LINES', 'entity_id' => 'whatsappbyedna|1|fixture|999',
                'entity_data_1' => 'Y|CONTACT|234025|N|N|322143|'.$sessionTime->timestamp.'|0|0|DEFAULT',
                'entity_data_2' => 'LEAD|0|COMPANY|0|CONTACT|234025|DEAL|0', 'owner' => 0, 'text_field_enabled' => true],
            'imopenlines.v2.Session.list' => ['hasNextPage' => false, 'sessions' => [
                ['id' => 322143, 'chatId' => 147259, 'configId' => 1, 'status' => 'new', 'dateCreate' => $sessionTime->toIso8601String(),
                    'dateClose' => null, 'operatorId' => null, 'dateOperatorAnswer' => null, 'dateFirstAnswer' => null],
            ]],
            'imopenlines.v2.Session.Stat.get' => ['sessions' => [['sessionId' => 322143, 'messagesOperatorCount' => 1, 'transfersCount' => 0]]],
            'imopenlines.v2.Session.Transfer.list' => ['transfers' => [], 'hasNextPage' => false],
            'imopenlines.session.history.get' => ['sessionId' => 322143, 'chatId' => 147259, 'hasNextPage' => false,
                'users' => [57 => ['connector' => false, 'bot' => false], 999 => ['connector' => true]],
                'message' => [
                    ['id' => '7167735', 'chatid' => '147259', 'senderid' => '999', 'date' => $sessionTime->toIso8601String(),
                        'text' => 'Quiero un préstamo'],
                    ['id' => '7167755', 'chatid' => '147259', 'senderid' => '57', 'date' => $rejectedAt->copy()->addSecond()->toIso8601String(),
                        'text' => '¡Hola! '.$template.'  ¡Gracias por tu consulta!',
                        'params' => ['class' => 'bx-messenger-content-item-ol-output', 'connectorMid' => ['synthetic-sent-mid']]],
                ]],
        ];
    }

    public function call(string $method, array $payload = []): mixed
    {
        if ($this->beforeCall) {
            ($this->beforeCall)($method);
        }
        if ($method === 'imopenlines.operator.another.finish') {
            expect($payload)->toBe(['CHAT_ID' => 147259]);
            ++$this->closeCalls;
            $session = &$this->responses['imopenlines.v2.Session.list']['sessions'][0];
            $session['status'] = 'closed';
            $session['dateClose'] = now()->toIso8601String();

            return true;
        }

        return $this->responses[$method] ?? throw new RuntimeException('Unexpected CRM call: '.$method);
    }
}

beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-27T13:00:00Z'));
    config(['app.key' => 'base64:'.base64_encode(str_repeat('t', 32)), 'cache.default' => 'array',
        'edna.enabled' => true, 'edna.intake_crm_enabled' => true, 'edna.rejection_close_enabled' => true, 'edna.subject_id' => '2423']);
    Http::preventStrayRequests();
    Queue::fake();
    DB::table('edna_intake_cutovers')->updateOrInsert(['name' => 'rejected-deal-chat-close-v1'],
        ['starts_at' => now()->subDay(), 'entry_id_after' => 0]);
    $entryAt = now()->subMinutes(10);
    $entry = DB::table('edna_incoming_events')->insertGetId([
        'subject_id' => '2423', 'message_id' => '11111', 'status' => 'delivered', 'created_at' => $entryAt, 'updated_at' => $entryAt,
        'payload' => Crypt::encryptString(json_encode(['id' => '11111', 'subjectId' => '2423', 'receivedAt' => $entryAt->toIso8601String()])),
    ]);
    $proof = ['verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'entry_event_id' => $entry, 'entry_message_id' => '11111', 'message_id' => '7167733',
        'chat_id' => '147259', 'session_id' => '322143', 'contact_id' => '234025', 'activity_id' => '728209'];
    DB::table('edna_organic_menus')->insert([
        'request_id' => (string) Str::uuid(), 'entry_event_id' => $entry, 'subject_id' => '2423', 'cascade_id' => '2557',
        'phone_hash' => hash('sha256', 'fixture'), 'recipient' => 'unused', 'chat_id' => 147259, 'session_id' => 322143,
        'proof' => json_encode($proof), 'choice' => 'loan', 'state' => 'loan_submitted',
        'profile_evidence' => json_encode(['result' => ['action' => 'queued', 'lead_id' => '433111']]),
        'entry_received_at' => $entryAt, 'expires_at' => now()->addDay(), 'created_at' => $entryAt, 'updated_at' => $entryAt,
    ]);
    $this->crm = new RejectedDealSessionCrm;
    $this->service = new EdnaRejectedChatClosure($this->crm);
    expect($this->service->poll())->toBe(1);
    $this->closureId = (int) DB::table('edna_rejected_chat_closures')->sole()->id;
});

test('a converted lead with a BCRA-rejected deal and its exact sent notice closes the untouched session once', function () {
    expect($this->service->process($this->closureId)['state'])->toBe('closed');
    $receipt = DB::table('edna_rejected_chat_closures')->find($this->closureId);
    $intent = json_decode($receipt->close_intent, true, flags: JSON_THROW_ON_ERROR);
    expect($intent)->toMatchArray(['chat_id' => 147259, 'session_id' => 322143, 'deal_id' => 1256777, 'notice_message_id' => '7167755'])
        ->and((bool) $receipt->close_acknowledged)->toBeTrue()
        ->and($this->service->process($this->closureId)['state'])->toBe('not_claimed')
        ->and($this->service->poll())->toBe(0)
        ->and($this->crm->closeCalls)->toBe(1);
    Http::assertNothingSent();
});

test('a new manual interaction or CRM change during verification preserves a rejected deal chat', function (string $change) {
    $dialogReads = 0;
    $this->crm->beforeCall = function (string $method) use ($change, &$dialogReads) {
        if ($method !== 'imopenlines.dialog.get' || ++$dialogReads !== 2) {
            return;
        }
        $data = &$this->crm->responses;
        switch ($change) {
            case 'client reply':
                $data['imopenlines.session.history.get']['message'][] = ['id' => '7167756', 'chatid' => '147259',
                    'senderid' => '999', 'date' => now()->toIso8601String(), 'text' => 'Tengo otra pregunta'];
                break;
            case 'Nico accepts':
                $data['imopenlines.v2.Session.list']['sessions'][0]['dateOperatorAnswer'] = now()->toIso8601String();
                $data['imopenlines.v2.Session.list']['sessions'][0]['operatorId'] = 74827;
                break;
            case 'seller takes deal':
                $data['crm.deal.get']['ASSIGNED_BY_ID'] = '12345';
                break;
            case 'reopened deal':
                $data['crm.deal.get']['CLOSED'] = 'N';
                $data['crm.deal.get']['STAGE_ID'] = 'C1:NEW';
                break;
            case 'replacement session':
                $data['imopenlines.dialog.get']['entity_data_1'] = str_replace('|322143|', '|322144|', $data['imopenlines.dialog.get']['entity_data_1']);
                break;
        }
    };
    expect($this->service->process($this->closureId)['state'])->toBe('preserved')
        ->and($this->crm->closeCalls)->toBe(0)
        ->and(DB::table('edna_rejected_chat_closures')->find($this->closureId)->close_intent)->toBeNull();
})->with(['client reply', 'Nico accepts', 'seller takes deal', 'reopened deal', 'replacement session']);

test('the final native inspection preserves attention acquired while the third deal read was in flight', function (string $change) {
    $dealReads = 0;
    $this->crm->beforeCall = function (string $method) use ($change, &$dealReads) {
        if ($method !== 'crm.deal.get' || ++$dealReads !== 3) {
            return;
        }
        $data = &$this->crm->responses;
        if ($change === 'reply') {
            $data['imopenlines.session.history.get']['message'][] = ['id' => '7167756', 'chatid' => '147259',
                'senderid' => '999', 'date' => now()->toIso8601String(), 'text' => 'Tengo otra pregunta'];
        } else {
            $data['imopenlines.v2.Session.list']['sessions'][0]['dateOperatorAnswer'] = now()->toIso8601String();
            $data['imopenlines.v2.Session.list']['sessions'][0]['operatorId'] = 74827;
        }
    };
    expect($this->service->process($this->closureId)['state'])->toBe('preserved')
        ->and($dealReads)->toBe(3)->and($this->crm->closeCalls)->toBe(0)
        ->and(DB::table('edna_rejected_chat_closures')->find($this->closureId)->close_intent)->toBeNull();
})->with(['reply', 'accept']);

test('a closed deal without its outbound connector receipt keeps the chat open', function () {
    unset($this->crm->responses['imopenlines.session.history.get']['message'][1]['params']['connectorMid']);
    expect($this->service->process($this->closureId)['state'])->toBe('waiting')
        ->and($this->crm->closeCalls)->toBe(0)
        ->and(DB::table('edna_rejected_chat_closures')->find($this->closureId)->close_intent)->toBeNull();
});

test('an earlier or ambiguously linked case cannot close the current session', function (string $change) {
    $old = now()->subDays(2);
    $data = &$this->crm->responses;
    switch ($change) {
        case 'old lead':
            $data['crm.lead.get']['DATE_CREATE'] = $old->toIso8601String();
            break;
        case 'old deal':
            $data['crm.deal.get']['DATE_CREATE'] = $old->toIso8601String();
            break;
        case 'old session':
            $data['imopenlines.v2.Session.list']['sessions'][0]['dateCreate'] = $old->toIso8601String();
            $data['imopenlines.dialog.get']['entity_data_1'] = 'Y|CONTACT|234025|N|N|322143|'.$old->timestamp.'|0|0|DEFAULT';
            break;
        case 'sibling deal':
            $data['crm.deal.list'][] = ['ID' => '1256780', 'LEAD_ID' => '433111'];
            break;
        case 'other activity owner':
            $data['crm.activity.get']['OWNER_ID'] = '1256780';
            break;
        case 'other dialog contact':
            $data['imopenlines.dialog.get']['entity_data_1'] = str_replace('|234025|', '|234026|', $data['imopenlines.dialog.get']['entity_data_1']);
            break;
    }
    expect($this->service->process($this->closureId)['state'])->toBe('preserved')
        ->and($this->crm->closeCalls)->toBe(0)
        ->and(DB::table('edna_rejected_chat_closures')->find($this->closureId)->close_intent)->toBeNull();
})->with(['old lead', 'old deal', 'old session', 'sibling deal', 'other activity owner', 'other dialog contact']);
