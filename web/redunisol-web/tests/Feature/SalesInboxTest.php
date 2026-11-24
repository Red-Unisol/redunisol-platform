<?php

use App\Services\EdnaBitrix;
use App\Services\EdnaCustomerWait;
use App\Services\SalesInbox;
use App\Services\SalesInboxPolicy;
use App\Services\SalesSessionFlow;
use App\Services\WebFormChatGuard;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

uses(RefreshDatabase::class);

class SalesInboxCrmFake extends EdnaBitrix
{
    public array $methods = [];

    public int $posts = 0;

    public int $snapshots = 0;

    public bool $acceptDuringCheck = false;

    public bool $throwAfterPost = false;

    public string $source = 'facebook';

    public string $message = '¿Cómo puedo consultar un préstamo?';

    public ?int $dealOwner = null;

    public ?string $closeDate = null;

    public ?string $nativeSource = null;

    public array $messageParams = [];

    public array $transfers = [];

    public function session(): array
    {
        return ['id' => 501, 'chatId' => 601, 'configId' => 1, 'source' => $this->source, 'dateCreate' => '2026-11-25T12:01:00Z',
            'operatorId' => null, 'dateClose' => $this->closeDate, 'dateFirstAnswer' => null, 'dateOperatorAnswer' => null,
            'status' => $this->closeDate ? 'closed' : 'new'];
    }

    public function call(string $method, array $payload = []): mixed
    {
        $this->methods[] = $method;
        if ($method === 'imopenlines.v2.Session.list') {
            $from = CarbonImmutable::parse($payload['dateCreateFrom']);
            $to = CarbonImmutable::parse($payload['dateCreateTo']);
            $s = $this->session();

            return ['sessions' => CarbonImmutable::parse($s['dateCreate'])->betweenIncluded($from, $to) ? [$s] : [], 'hasNextPage' => false];
        }
        if ($method === 'imopenlines.session.history.get') {
            return ['chatId' => 601, 'sessionId' => 501, 'hasNextPage' => false, 'users' => [999 => ['connector' => true]],
                'message' => [['id' => 300, 'chatid' => 601, 'senderid' => 999, 'date' => '2026-11-25T12:01:07Z', 'text' => $this->message, 'params' => $this->messageParams]]];
        }
        if ($method === 'imopenlines.operator.transfer' || $method === 'imopenlines.operator.another.finish') {
            $this->posts++;
            if ($method === 'imopenlines.operator.transfer') {
                $this->transfers[] = ['sessionId' => 501, 'date' => now()->utc()->toIso8601String(), 'fromConfigId' => 1,
                    'fromOperatorId' => 71283, 'initiatorId' => 71283, 'toOperatorId' => $payload['USER_ID'], 'type' => 'USER', 'mode' => 'MANUAL'];
            } else {
                $this->closeDate = now()->utc()->toIso8601String();
            }
            if ($this->throwAfterPost) {
                throw new RuntimeException('Response lost');
            }

            return true;
        }

        return match ($method) {
            'imopenlines.dialog.get' => ['id' => 601, 'entity_type' => 'LINES', 'entity_id' => $this->nativeSource ?? $this->source.'|1|origin|ext',
                'entity_data_1' => 'Y|LEAD|1000|N|N|501|'.CarbonImmutable::parse('2026-11-25T12:01:00Z')->timestamp,
                'entity_data_2' => 'LEAD|1000|CONTACT|0|DEAL|0', 'text_field_enabled' => true,
                'owner' => $this->acceptDuringCheck && ++$this->snapshots >= 3 ? 371 : 74827],
            'imopenlines.config.get' => ['ID' => 1, 'QUEUE' => [['ENTITY_TYPE' => 'user', 'ENTITY_ID' => '74827']]],
            'imopenlines.v2.Session.Stat.get' => ['sessions' => [['sessionId' => 501, 'messagesOperatorCount' => 0, 'transfersCount' => count($this->transfers)]]],
            'imopenlines.v2.Session.Transfer.list' => ['transfers' => $this->transfers],
            'crm.lead.get' => ['ID' => $payload['id'], 'ASSIGNED_BY_ID' => '74827', 'STATUS_SEMANTIC_ID' => 'P'],
            'crm.deal.list' => $this->dealOwner ? [['ID' => 19, 'LEAD_ID' => 1000, 'CATEGORY_ID' => 1, 'STAGE_SEMANTIC_ID' => 'P', 'ASSIGNED_BY_ID' => $this->dealOwner]] : [],
            'user.get' => [['ID' => $payload['FILTER']['ID'], 'ACTIVE' => true, 'USER_TYPE' => 'employee', 'UF_DEPARTMENT' => [1]]],
            default => throw new LogicException('Unexpected provider method: '.$method),
        };
    }
}

function newSalesInbox(SalesInboxCrmFake $crm): SalesInbox
{
    config(['edna.sales_inbox_enabled' => true, 'edna.intake_crm_enabled' => true, 'edna.sales_social_operator_id' => 5737,
        'edna.bitrix_url' => 'https://redunisol.bitrix24.es/rest/71283/example']);

    return new SalesInbox($crm, new WebFormChatGuard($crm), new SalesInboxPolicy);
}

beforeEach(fn () => $this->travelTo(CarbonImmutable::parse('2026-11-25T12:00:00Z')));
afterEach(fn () => $this->travelBack());

test('new social session uses linked seller before social desk and confirms exactly one native event', function (?int $owner, int $expected) {
    $crm = new SalesInboxCrmFake;
    $crm->dealOwner = $owner;
    $inbox = newSalesInbox($crm);
    $inbox->poll();
    expect(DB::table('sales_inbox_sessions')->count())->toBe(0);
    $this->travel(4)->minutes();
    $inbox->poll();
    $inbox->poll();
    $r = DB::table('sales_inbox_sessions')->first();
    $post = array_search('imopenlines.operator.transfer', $crm->methods, true);
    expect(array_slice($crm->methods, $post - 3, 3))->toBe(['imopenlines.v2.Session.list', 'imopenlines.v2.Session.Transfer.list', 'imopenlines.dialog.get']);
    expect($r->state)->toBe('transferred')->and($r->acknowledged)->toBeTruthy()
        ->and(strlen($r->native_event_sha256))->toBe(64)->and(json_decode($r->intent, true)['target_id'])->toBe($expected)->and($crm->posts)->toBe(1);
})->with([[371, 371], [null, 5737]]);

test('ordinary WhatsApp stays with intake while an unambiguous standalone terminal reply may close once', function (string $message, string $state, int $effects) {
    $crm = new SalesInboxCrmFake;
    $crm->source = 'whatsappbyedna';
    $crm->message = $message;
    $inbox = newSalesInbox($crm);
    $inbox->poll();
    $this->travel(4)->minutes();
    $inbox->poll();
    $inbox->poll();
    expect(DB::table('sales_inbox_sessions')->value('state'))->toBe($state)->and($crm->posts)->toBe($effects);
})->with([['¡Muchas gracias!', 'closed', 1], ['Gracias, ¿cuándo cobro?', 'waiting', 0]]);

test('previous seller, actual take-over and uncertain POST are handled without duplicate transfers', function (string $scenario) {
    $crm = new SalesInboxCrmFake;
    $inbox = newSalesInbox($crm);
    $crm->acceptDuringCheck = $scenario === 'human';
    $crm->throwAfterPost = $scenario === 'lost_ack';
    $crm->dealOwner = $scenario === 'provisional' ? 57 : null;
    $inbox->poll();
    $this->travel(4)->minutes();
    $inbox->poll();
    $this->travel(30)->minutes();
    $inbox->poll();
    $r = DB::table('sales_inbox_sessions')->first();
    expect($crm->posts)->toBe($scenario === 'lost_ack' ? 1 : 0);
    if ($scenario === 'lost_ack') {
        expect($r->state)->toBe('observed')->and($r->acknowledged)->toBeFalsy();
    }
})->with(['human', 'lost_ack', 'provisional']);

test('verified delivered flow wakes at its own deadline; missing evidence remains an explicit exception', function (bool $delivered) {
    $crm = new SalesInboxCrmFake;
    $crm->source = 'whatsappbyedna';
    $inbox = newSalesInbox($crm);
    $due = CarbonImmutable::parse('2026-11-26T16:30:00Z');
    $wait = Mockery::mock(EdnaCustomerWait::class);
    $wait->shouldReceive('dueAt')->with(501, 601, '2026-11-25T12:01:07Z', 300)->andReturn($delivered ? $due : null);
    app()->instance(EdnaCustomerWait::class, $wait);
    $inbox->poll();
    $this->travel(4)->minutes();
    $inbox->poll();
    $row = DB::table('sales_inbox_sessions')->first();
    expect($row->state)->toBe($delivered ? 'waiting_customer' : 'waiting')->and($crm->posts)->toBe(0);
    $this->travelTo($due->subMinute());
    $inbox->poll();
    expect($crm->posts)->toBe(0);
    $this->travelTo($due->addSecond());
    $inbox->poll();
    $row = DB::table('sales_inbox_sessions')->first();
    expect($row->state)->toBe($delivered ? 'closed' : 'needs_attention')->and($crm->posts)->toBe($delivered ? 1 : 0);
})->with([[true], [false]]);

test('an effect missing both acknowledgement and native evidence remains visible after the retry ceiling', function () {
    $crm = new SalesInboxCrmFake;
    $inbox = newSalesInbox($crm);
    $crm->throwAfterPost = true;
    $inbox->poll();
    $this->travel(4)->minutes();
    $inbox->poll();
    $crm->transfers = [];
    $this->travel(4)->days();
    $inbox->poll();
    $inbox->poll();
    $r = DB::table('sales_inbox_sessions')->first();
    expect($r->state)->toBe('needs_attention')->and($r->reason)->toBe('effect_pending_confirmation')->and($r->intent)->not->toBeNull()
        ->and($r->available_at)->toBeNull()->and($crm->posts)->toBe(1);
});

test('missing channel outcomes distinguish a missing callback from a received callback using exact native subject and message', function (string $variant, string $expected) {
    $crm = new SalesInboxCrmFake;
    $crm->source = 'whatsappbyedna';
    $crm->nativeSource = 'whatsappbyedna|1|5491100000000@22|300';
    $crm->messageParams = ['connectorMid' => ['200']];
    $inbox = newSalesInbox($crm);
    config(['edna.subject_id' => $variant === 'wrong_subject' ? '23' : '22']);
    if ($variant === 'received') {
        DB::table('edna_incoming_events')->insert(['subject_id' => '22', 'message_id' => '200']);
    }
    $inbox->poll();
    $this->travel(9)->hours();
    // An outage can leave discovery behind; exercise the already durably captured row.
    DB::table('sales_inbox_sessions')->insert(['session_id' => 501, 'chat_id' => 601, 'channel' => $crm->source, 'opened_at' => '2026-11-25 12:01:00',
        'state' => 'pending', 'available_at' => now()]);
    $inbox->poll();
    $row = DB::table('sales_inbox_sessions')->first();
    expect($row->state)->toBe('needs_attention')->and($row->reason)->toBe($expected)->and($crm->posts)->toBe(0);
})->with([['missing', 'native_message_missing_callback'], ['received', 'callback_received_without_verified_outcome'], ['wrong_subject', 'callback_identity_unverified']]);

test('a confirmed after-hours notice waits until the real window ends and an unfinished commercial case remains actionable', function () {
    $crm = new SalesInboxCrmFake;
    $crm->source = 'whatsappbyedna';
    $crm->nativeSource = 'whatsappbyedna|1|5491100000000@22|300';
    $crm->messageParams = ['connectorMid' => ['200']];
    $inbox = newSalesInbox($crm);
    config(['edna.subject_id' => '22', 'edna.cascade_id' => '33']);
    $event = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '22', 'message_id' => '200']);
    $opens = now()->addHours(12);
    DB::table('edna_out_of_hours_sends')->insert(['event_id' => $event, 'scope' => str_repeat('a', 64), 'request_id' => (string) Str::uuid(),
        'subject_id' => '22', 'cascade_id' => '33', 'received_at' => now(), 'window_start' => now()->subHour(), 'window_end' => $opens,
        'notice_type' => 'general', 'policy_version' => '1', 'policy_reason' => 'closed', 'state' => 'confirmed', 'outgoing_message_id' => '711']);
    $inbox->poll();
    $this->travel(4)->minutes();
    $inbox->poll();
    $row = DB::table('sales_inbox_sessions')->first();
    expect($row->reason)->toBe('outside_hours_notice_confirmed')->and($row->available_at)->toBe($opens->format('Y-m-d H:i:s'));
    $this->travelTo($opens->addSecond());
    $inbox->poll();
    $row = DB::table('sales_inbox_sessions')->first();
    expect($row->state)->toBe('needs_attention')->and($row->reason)->toBe('no_chat_outcome_after_opening')->and($crm->posts)->toBe(0);
});

test('a v3 response cannot be reported as missing callback, completed distribution or customer waiting', function (string $state, string $reason) {
    DB::table('edna_intake_requests')->insert(['flow_send_id' => 82, 'response_event_id' => 99, 'received_at' => now(), 'state' => $state]);
    $decision = (new SalesSessionFlow)->disposition((object) ['id' => 82, 'response_event_id' => 99, 'completed_at' => now(), 'state' => 'completed']);
    expect($decision)->toBe(['state' => $state === 'review' ? 'needs_attention' : 'waiting', 'reason' => $reason]);
})->with([['pending', 'v3_answer_processing'], ['synced', 'v3_synced_awaiting_chat_disposition'], ['review', 'v3_answer_requires_reconciliation']]);

test('unknown sources are observable and repeated provider pages leave the checkpoint unchanged', function () {
    $crm = new class extends SalesInboxCrmFake
    {
        public int $pages = 0;

        public function call(string $method, array $payload = []): mixed
        {
            if ($method === 'imopenlines.v2.Session.list') {
                if (++$this->pages > 2) {
                    throw new LogicException('Too many repeated pages');
                }

                return ['sessions' => [$this->session()], 'hasNextPage' => true];
            }

            return parent::call($method, $payload);
        }
    };
    $crm->source = 'unrecognized';
    $inbox = newSalesInbox($crm);
    $inbox->poll();
    $checkpoint = DB::table('sales_inbox_cursors')->value('scanned_until');
    $this->travel(4)->minutes();
    $inbox->poll();
    expect($crm->pages)->toBe(2)->and(DB::table('sales_inbox_cursors')->value('scanned_until'))->toBe($checkpoint)
        ->and(DB::table('sales_inbox_sessions')->value('reason'))->toBe('unsupported_source')->and($crm->posts)->toBe(0);
    $exit = Artisan::call('sales:inbox', ['--date' => '2026-11-25']);
    $status = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);
    expect($exit)->toBe(0)->and($status['cursor_age_seconds'])->toBe(240)->and($status['oldest_needing_attention'][0]['session_id'])->toBe(501)
        ->and($status['dispositions'][0]['total'])->toBe(1)->and($status['overdue_sessions'])->toBe(0);
});

test('courtesy never masks an outstanding request or a media message', function () {
    $p = new SalesInboxPolicy;
    $s = (object) ['chat_id' => 4, 'session_id' => 3];
    $m = ['id' => 8, 'chatid' => 4, 'senderid' => 9, 'date' => '2026-11-25T12:00:01Z', 'text' => 'Gracias'];
    $history = ['chatId' => 4, 'sessionId' => 3, 'users' => [9 => ['connector' => true]], 'hasNextPage' => false,
        'message' => [$m, array_replace($m, ['id' => 7, 'text' => 'Quiero un préstamo'])]];
    expect($p->conversation($history, $s)['reason'])->toBe('customer_request');
    $history['message'] = [$m + ['params' => ['FILE_ID' => [29]]]];
    expect($p->conversation($history, $s)['reason'])->toBe('customer_request');
});
