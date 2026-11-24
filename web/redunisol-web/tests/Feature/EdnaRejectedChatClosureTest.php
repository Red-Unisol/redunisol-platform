<?php

use App\Jobs\CloseEdnaRejectedChat;
use App\Services\EdnaBitrix;
use App\Services\EdnaRejectedChatCandidates;
use App\Services\EdnaRejectedChatClosure;
use App\Services\EdnaRejectedChatGuard;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

class RejectedClosureCrmFake extends EdnaBitrix
{
    public array $calls = [];

    public array $lead;

    public array $history;

    public array $activity;

    public array $session;

    public string $closeMode = 'ack';

    public int $closeCalls = 0;

    public int $leadReads = 0;

    public ?Closure $beforeCall = null;

    public function __construct(string $text)
    {
        $this->lead = ['ID' => '428407', 'CONTACT_ID' => null, 'STATUS_ID' => 'UC_1P8I07',
            'ASSIGNED_BY_ID' => '74827', 'UF_CRM_REJ_NOTICE' => 'PROCESSED', 'UF_CRM_REJECTION_REASON' => '3965',
            'MOVED_TIME' => now()->subMinutes(5)->toIso8601String()];
        $this->activity = ['ID' => '713509', 'OWNER_TYPE_ID' => '1', 'OWNER_ID' => '428407',
            'PROVIDER_ID' => 'IMOPENLINES_SESSION', 'ASSOCIATED_ENTITY_ID' => '318043'];
        $this->history = ['chatId' => 145661, 'sessionId' => 318043, 'hasNextPage' => false,
            'users' => ['74827' => ['id' => 74827, 'connector' => false, 'bot' => false]],
            'message' => ['7083585' => ['id' => '7083585', 'senderid' => '74827', 'chatid' => '145661',
                'date' => now()->subMinutes(4)->toIso8601String(), 'text' => $text,
                'params' => ['class' => 'bx-messenger-content-item-ol-output', 'connectorMid' => ['notice-native-mid']]]]];
        $this->session = ['id' => 318043, 'chatId' => 145661, 'configId' => 1, 'status' => 'new',
            'dateCreate' => now()->subHours(6)->toIso8601String(), 'dateClose' => null, 'operatorId' => null, 'dateOperatorAnswer' => null, 'dateFirstAnswer' => null];
    }

    public function call(string $method, array $payload = []): mixed
    {
        $this->calls[] = [$method, $payload];
        if ($method === 'crm.lead.get') {
            $this->leadReads++;
        }
        if ($this->beforeCall) {
            ($this->beforeCall)($method, $payload);
        }
        if ($method === 'imopenlines.operator.another.finish') {
            expect($payload)->toBe(['CHAT_ID' => 145661]);
            $this->closeCalls++;
            if ($this->closeMode !== 'lost_before_apply') {
                $this->session['status'] = 'closed';
                $this->session['dateClose'] = now()->toIso8601String();
            }
            if ($this->closeMode === 'false_ack') {
                return false;
            }
            if ($this->closeMode !== 'ack') {
                throw new RuntimeException('Transport outcome unavailable.');
            }

            return true;
        }

        return match ($method) {
            'imopenlines.dialog.get' => ['id' => 145661, 'entity_type' => 'LINES',
                'entity_id' => 'whatsappbyedna|1|5493510000000@2423|129725',
                'entity_data_1' => 'Y|LEAD|428407|N|N|318043|'.CarbonImmutable::parse($this->session['dateCreate'])->timestamp.'|0|0|DEFAULT',
                'entity_data_2' => 'LEAD|428407|CONTACT|0|DEAL|0', 'owner' => 0, 'text_field_enabled' => true],
            'imopenlines.v2.Session.Stat.get' => ['sessions' => [['sessionId' => 318043, 'messagesOperatorCount' => 1, 'transfersCount' => 0]]],
            'imopenlines.v2.Session.Transfer.list' => ['transfers' => [], 'hasNextPage' => false],
            'crm.lead.get' => $this->lead,
            'crm.lead.list' => [['ID' => '428407']],
            'crm.lead.fields' => ['UF_CRM_REJECTION_REASON' => ['items' => [['ID' => '3965', 'VALUE' => 'NO CUMPLE REQUISITOS PARA CONVENIO']]]],
            'crm.activity.get' => $this->activity,
            'imopenlines.session.history.get' => $this->history,
            'imopenlines.v2.Session.list' => ['hasNextPage' => false, 'sessions' => [$this->session]],
            default => throw new RuntimeException('Unexpected operation '.$method),
        };
    }
}

class RejectedClosureGuardFake extends EdnaRejectedChatGuard
{
    public int $calls = 0;

    public ?Closure $beforeInspect = null;

    public array $result;

    public function __construct()
    {
        $this->result = ['status' => 'ready', 'reason' => 'unattended_rejected_session', 'owner_id' => 0, 'session_id' => 318043,
            'session_created_at' => now()->subHours(6)->toIso8601String(), 'dialog' => ['entity_data_1' => 'Y|LEAD|428407|N|N|318043|0']];
    }

    public function inspect(array $proof, array $notice): array
    {
        $this->calls++;
        if ($this->beforeInspect) {
            ($this->beforeInspect)($this->calls, $proof, $notice);
        }

        return $this->result;
    }
}

beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-18T12:00:00Z'));
    config()->set('edna.enabled', true);
    config()->set('edna.intake_crm_enabled', true);
    config()->set('edna.rejection_close_enabled', true);
    config()->set('cache.default', 'array');
    Http::preventStrayRequests();
    Queue::fake();
});

function rejectedClosureFixture(): object
{
    $catalog = json_decode(file_get_contents(resource_path('crm/rejection-notices.json')), true);
    $notice = array_values(array_filter($catalog['notices'], fn ($n) => $n['reason_label'] === 'NO CUMPLE REQUISITOS PARA CONVENIO'))[0];
    $crm = new RejectedClosureCrmFake($notice['text']);
    $guard = new RejectedClosureGuardFake;
    $proof = ['version' => 2, 'verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'chat_id' => '145661', 'session_id' => '318043', 'activity_id' => '713509'];
    $id = DB::table('edna_rejected_chat_closures')->insertGetId(['chat_id' => 145661, 'session_id' => 318043, 'lead_id' => 428407,
        'source_type' => 'edna_intake_request', 'source_id' => '796', 'source_created_at' => now()->subHours(6),
        'proof' => json_encode($proof), 'state' => 'pending', 'expires_at' => now()->addHours(8), 'available_at' => now(),
        'created_at' => now(), 'updated_at' => now()]);

    return (object) ['id' => $id, 'crm' => $crm, 'guard' => $guard, 'proof' => $proof, 'service' => new EdnaRejectedChatClosure($crm, $guard)];
}
function rejectedClosureRow(object $f): object
{
    return DB::table('edna_rejected_chat_closures')->find($f->id);
}

test('a rejected and notified unattended session closes once with a durable intent acknowledgement and verification', function () {
    $f = rejectedClosureFixture();
    expect($f->service->process($f->id))->toBe(['state' => 'closed', 'reason' => 'rejected_session_closed'])
        ->and($f->crm->closeCalls)->toBe(1)->and($f->guard->calls)->toBe(2);
    $row = rejectedClosureRow($f);
    expect((bool) $row->close_acknowledged)->toBeTrue()->and(json_decode($row->close_intent, true))->toMatchArray([
        'chat_id' => 145661, 'session_id' => 318043, 'lead_id' => 428407, 'notice_message_id' => '7083585']);
    expect($f->service->process($f->id)['state'])->toBe('not_claimed')->and($f->crm->closeCalls)->toBe(1);
    foreach ($f->crm->calls as [$method]) {
        expect($method)->not->toContain('answer', 'transfer', 'update', 'add');
    }
});

test('a notification field alone never closes a chat without the exact output in that same session', function (string $change) {
    $f = rejectedClosureFixture();
    match ($change) {
        'missing' => $f->crm->history['message'] = [],
        'wrong_text' => $f->crm->history['message']['7083585']['text'] = 'No podemos ayudarte.',
        'customer_copy' => $f->crm->history['users']['74827']['connector'] = true,
        'no_output' => $f->crm->history['message']['7083585']['params']['class'] = 'ordinary-message',
        'no_mid' => $f->crm->history['message']['7083585']['params']['connectorMid'] = [],
        'wrong_session' => $f->crm->history['sessionId'] = 123,
        'incomplete' => $f->crm->history['hasNextPage'] = true,
        'old_notice' => $f->crm->history['message']['7083585']['date'] = now()->subDay()->toIso8601String(),
    };
    $result = $f->service->process($f->id);
    expect($result['state'])->toBe('waiting')->and($f->crm->closeCalls)->toBe(0)->and(rejectedClosureRow($f)->close_intent)->toBeNull();
})->with(['missing', 'wrong_text', 'customer_copy', 'no_output', 'no_mid', 'wrong_session', 'incomplete', 'old_notice']);

test('duplicate matching notices are retained for review rather than relaxing the human message count', function () {
    $f = rejectedClosureFixture();
    $f->crm->history['message']['7083586'] = array_replace($f->crm->history['message']['7083585'], ['id' => '7083586']);
    expect($f->service->process($f->id))->toMatchArray(['state' => 'review', 'reason' => 'multiple_rejection_notices'])
        ->and($f->crm->closeCalls)->toBe(0);
});

test('nonrejection notice states and manual CRM ownership do not close', function (string $field, mixed $value, string $state) {
    $f = rejectedClosureFixture();
    $f->crm->lead[$field] = $value;
    expect($f->service->process($f->id)['state'])->toBe($state)->and($f->crm->closeCalls)->toBe(0);
})->with([['STATUS_ID', 'NEW', 'preserved'], ['STATUS_ID', 'CONVERTED', 'preserved'], ['UF_CRM_REJ_NOTICE', 'IN_PROGRESS', 'waiting'],
    ['UF_CRM_REJ_NOTICE', 'HISTORICAL', 'waiting'], ['UF_CRM_REJ_NOTICE', '', 'waiting'], ['ASSIGNED_BY_ID', '29', 'preserved'], ['MOVED_TIME', null, 'review'], ['UF_CRM_REJECTION_REASON', 'unknown', 'review']]);

test('a changed CRM activity cannot authorize closing the current conversation', function (string $field, string $value) {
    $f = rejectedClosureFixture();
    $f->crm->activity[$field] = $value;
    expect($f->service->process($f->id)['state'])->toBe('preserved')->and($f->crm->closeCalls)->toBe(0);
})->with([['OWNER_TYPE_ID', '2'], ['OWNER_ID', '999'], ['ASSOCIATED_ENTITY_ID', '999'], ['PROVIDER_ID', 'OTHER']]);

test('a protected final read cancels closure after a first eligible read', function (string $status, string $reason) {
    $f = rejectedClosureFixture();
    $f->guard->beforeInspect = function ($count) use ($f, $status, $reason) {
        if ($count === 2) {
            $f->guard->result['status'] = $status;
            $f->guard->result['reason'] = $reason;
        }
    };
    expect($f->service->process($f->id)['state'])->toBe('preserved')->and($f->crm->closeCalls)->toBe(0);
})->with([['preserved', 'operator_attention_preserved'], ['preserved', 'customer_message_after_notice'], ['replaced', 'session_replaced']]);

test('a lead reopened between inspections cancels closure', function () {
    $f = rejectedClosureFixture();
    $f->crm->beforeCall = function ($method) use ($f) {
        if ($method === 'crm.lead.get' && $f->crm->leadReads === 2) {
            $f->crm->lead['STATUS_ID'] = 'NEW';
        }
    };
    expect($f->service->process($f->id))->toMatchArray(['state' => 'preserved', 'reason' => 'lead_not_rejected'])->and($f->crm->closeCalls)->toBe(0);
});

test('the dialog must still represent this rejected lead or its exact contact', function () {
    $f = rejectedClosureFixture();
    $f->guard->result['dialog']['entity_data_1'] = 'Y|LEAD|999|N|N|318043';
    expect($f->service->process($f->id)['reason'])->toBe('dialog_case_changed')->and($f->crm->closeCalls)->toBe(0);
});

test('a contact-native rejection can close without rewriting native CRM associations', function () {
    $f = rejectedClosureFixture();
    $f->crm->lead['CONTACT_ID'] = '205259';
    $f->crm->activity['OWNER_TYPE_ID'] = '3';
    $f->crm->activity['OWNER_ID'] = '205259';
    $f->guard->result['dialog']['entity_data_1'] = 'Y|CONTACT|205259|N|N|318043';
    expect($f->service->process($f->id)['state'])->toBe('closed')->and($f->crm->closeCalls)->toBe(1);
});

test('an uncertain POST is reconciled without ever being sent again', function (string $mode, string $state) {
    $f = rejectedClosureFixture();
    $f->crm->closeMode = $mode;
    expect($f->service->process($f->id)['state'])->toBe($state)->and($f->crm->closeCalls)->toBe(1)
        ->and(rejectedClosureRow($f)->close_intent)->not->toBeNull()->and((bool) rejectedClosureRow($f)->close_acknowledged)->toBeFalse();
    if ($state === 'unknown') {
        $this->travelTo(CarbonImmutable::parse(rejectedClosureRow($f)->available_at)->addSecond());
    }
    $f->service->process($f->id);
    expect($f->crm->closeCalls)->toBe(1)->and($f->guard->calls)->toBe(2);
})->with([['lost_before_apply', 'unknown'], ['lost_after_apply', 'observed'], ['false_ack', 'observed']]);

test('an already closed session is observed without claiming authorship or issuing a POST', function () {
    $f = rejectedClosureFixture();
    $f->guard->result['status'] = 'closed';
    expect($f->service->process($f->id))->toMatchArray(['state' => 'observed', 'reason' => 'session_already_closed'])->and($f->crm->closeCalls)->toBe(0)
        ->and((bool) rejectedClosureRow($f)->close_acknowledged)->toBeFalse();
});

test('expiry during the POST retains the positive acknowledgement and never replays', function () {
    $f = rejectedClosureFixture();
    DB::table('edna_rejected_chat_closures')->update(['expires_at' => now()->addSeconds(5)]);
    $f->crm->beforeCall = function ($method) {
        if ($method === 'imopenlines.operator.another.finish') {
            $this->travel(10)->seconds();
        }
    };
    expect($f->service->process($f->id)['state'])->toBe('review')->and((bool) rejectedClosureRow($f)->close_acknowledged)->toBeTrue()
        ->and(rejectedClosureRow($f)->close_intent)->not->toBeNull()->and($f->crm->closeCalls)->toBe(1);
    $f->service->process($f->id);
    expect($f->crm->closeCalls)->toBe(1);
});

test('a lease taken during final inspection supersedes the old worker without an external write', function () {
    $f = rejectedClosureFixture();
    $f->guard->beforeInspect = function ($count) {
        if ($count === 2) {
            DB::table('edna_rejected_chat_closures')->update(['lease_token' => 'new-worker']);
        }
    };
    expect($f->service->process($f->id)['state'])->toBe('superseded')->and($f->crm->closeCalls)->toBe(0);
});

test('the chat lock prevents closure while another linking or transfer worker is active', function () {
    $f = rejectedClosureFixture();
    $lock = Cache::lock('web-form-chat:145661', 120);
    $lock->get();
    try {
        expect($f->service->process($f->id))->toMatchArray(['state' => 'waiting', 'reason' => 'chat_work_in_progress'])->and($f->crm->calls)->toBe([]);
    } finally {
        $lock->release();
    }
});

test('disabled closure neither discovers nor calls Bitrix', function () {
    $f = rejectedClosureFixture();
    config()->set('edna.rejection_close_enabled', false);
    expect($f->service->poll())->toBe(0)->and($f->service->process($f->id)['state'])->toBe('disabled')->and($f->crm->calls)->toBe([]);
});

test('a new monitored session can discover a rejection after the one-day input window', function () {
    $f = rejectedClosureFixture();
    config(['edna.sales_inbox_enabled' => true]);
    DB::table('edna_rejected_chat_closures')->delete();
    $candidate = ['lead_id' => '428407', 'proof' => $f->proof, 'source_type' => 'edna_intake_request',
        'source_id' => '796', 'source_created_at' => now()->subMinutes(10)->toIso8601String()];
    $discovery = Mockery::mock(EdnaRejectedChatCandidates::class);
    $discovery->shouldReceive('discover')->andReturn([$candidate], []);
    app()->instance(EdnaRejectedChatCandidates::class, $discovery);
    DB::table('sales_inbox_sessions')->insert(['session_id' => $f->proof['session_id'], 'chat_id' => $f->proof['chat_id'], 'channel' => 'whatsappbyedna',
        'opened_at' => now()->subMinutes(10), 'state' => 'waiting', 'created_at' => now(), 'updated_at' => now()]);
    $crm = Mockery::mock(EdnaBitrix::class);
    $crm->shouldReceive('call')->with('crm.lead.list', Mockery::any())->andReturn([], [['ID' => '428407']]);
    $service = new EdnaRejectedChatClosure($crm);
    expect($service->poll())->toBe(0)->and(DB::table('sales_rejection_watches')->count())->toBe(1);
    $this->travel(49)->hours();
    expect($service->poll())->toBe(1)->and(DB::table('edna_rejected_chat_closures')->value('session_id'))->toEqual($f->proof['session_id'])
        ->and(DB::table('sales_rejection_watches')->count())->toBe(0);
});

test('polling creates only one durable low priority job per rejected native session', function () {
    $f = rejectedClosureFixture();
    DB::table('edna_rejected_chat_closures')->delete();
    $c = ['lead_id' => '428407', 'proof' => $f->proof, 'source_type' => 'edna_intake_request', 'source_id' => '796', 'source_created_at' => now()->subHour()->toIso8601String()];
    app()->instance(EdnaRejectedChatCandidates::class, new class($c) extends EdnaRejectedChatCandidates
    {
        public function __construct(private array $candidate) {}

        public function discover(int $limit = 200): array
        {
            return [$this->candidate];
        }
    });
    expect($f->service->poll())->toBe(1)->and($f->service->poll())->toBe(0)
        ->and(DB::table('edna_rejected_chat_closures')->count())->toBe(1)
        ->and(DB::table('jobs')->sole()->queue)->toBe('edna-rejection-close')->and(DB::table('edna_work_queue_keys')->count())->toBe(1);
    Queue::assertPushed(CloseEdnaRejectedChat::class, 1);
    DB::table('jobs')->update(['reserved_at' => now()->timestamp]);
    expect($f->service->poll())->toBe(0)->and(DB::table('jobs')->count())->toBe(1);
});

test('status is a technical read-only view and never invokes the closer', function () {
    $f = rejectedClosureFixture();
    app()->instance(EdnaRejectedChatClosure::class, $f->service);
    $this->artisan('edna:rejected-chats status')->assertSuccessful();
    expect($f->crm->calls)->toBe([])->and(rejectedClosureRow($f)->state)->toBe('pending');
});

test('reopening or modifying the rejection during the final human guard cancels the close', function (string $field, string $value) {
    $f = rejectedClosureFixture();
    $f->guard->beforeInspect = function ($count) use ($f, $field, $value) {
        if ($count === 2) {
            $f->crm->lead[$field] = $value;
        }
    };
    expect($f->service->process($f->id)['state'])->toBe('preserved')->and($f->crm->closeCalls)->toBe(0)->and(rejectedClosureRow($f)->close_intent)->toBeNull();
})->with([['STATUS_ID', 'NEW'], ['MOVED_TIME', '2026-11-18T11:59:00Z']]);

test('an uncertain state missing its receipt fails closed without a POST', function () {
    $f = rejectedClosureFixture();
    DB::table('edna_rejected_chat_closures')->update(['state' => 'unknown']);
    expect($f->service->process($f->id))->toMatchArray(['state' => 'review', 'reason' => 'closure_receipt_incomplete'])
        ->and($f->crm->closeCalls)->toBe(0);
});

test('the actual human guard accepts the robot notice under Nico and native system records without a system flag', function () {
    $f = rejectedClosureFixture();
    $f->crm->history['message']['7083500'] = ['id' => '7083500', 'chatid' => '145661', 'senderid' => '0',
        'date' => now()->subMinutes(6)->toIso8601String(), 'text' => 'Synthetic native system event', 'system' => null, 'params' => []];
    $f->crm->history['users']['0'] = ['id' => 0, 'connector' => false, 'bot' => false];
    $service = new EdnaRejectedChatClosure($f->crm, new EdnaRejectedChatGuard($f->crm));
    expect($service->process($f->id)['state'])->toBe('closed')->and($f->crm->closeCalls)->toBe(1);
});

test('the actual human guard preserves a newly replied customer message after the rejection notice', function () {
    $f = rejectedClosureFixture();
    $f->crm->history['message']['7083586'] = ['id' => '7083586', 'chatid' => '145661', 'senderid' => '129725',
        'date' => now()->subMinutes(3)->toIso8601String(), 'text' => 'Synthetic new customer inquiry', 'params' => []];
    $f->crm->history['users']['129725'] = ['connector' => true];
    $service = new EdnaRejectedChatClosure($f->crm, new EdnaRejectedChatGuard($f->crm));
    expect($service->process($f->id)['state'])->toBe('preserved')->and($f->crm->closeCalls)->toBe(0);
});
