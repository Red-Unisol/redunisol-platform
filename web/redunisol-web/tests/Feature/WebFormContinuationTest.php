<?php

use App\Jobs\ReceiveEdnaInKestra;
use App\Jobs\SendEdnaFlow;
use App\Services\AttributionJourney;
use App\Services\WebFormContinuation;
use App\Services\WebFormReceipt;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 6)->setTime(17, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('w', 32)));
    config()->set('edna', ['enabled' => true, 'webhook_key' => 'web-form-test', 'auth_header' => 'Authorization',
        'subject_id' => '2423', 'kestra_url' => 'https://kestra.example.test/incoming',
        'router_enabled' => true, 'router_start_at' => now()->subDays(3)->toIso8601String(), 'router_recipients' => [],
        'api_key' => 'test', 'cascade_id' => '2557', 'intake_enabled' => true, 'intake_crm_enabled' => true,
        'intake_flow_id' => '999000111222333', 'intake_start_at' => now()->subDays(2)->toIso8601String(),
        'intake_entry_scope' => 'sales_channel', 'intake_sales_channel_start_at' => now()->subDay()->toIso8601String(),
        'intake_recipients' => [], 'intake_pilot_id' => 'web-continuation-test', 'intake_pilot_limit' => 'unlimited',
        'intake_processing_url' => 'https://kestra.example.test/bitrix24_whatsapp_intake/test']);
    Http::preventStrayRequests();
    Http::fake([]);
    Queue::fake();
});

function continuationForm(string $cuil = '20301234563', string $phone = '3510000000'): array
{
    return ['celular' => $phone, 'cuil' => $cuil, '_journey_links' => ['submission_id' => (string) Str::uuid()]];
}

function continuationEntry(string $text = 'Hola', string $phone = '5493510000000'): object
{
    test()->postJson('/api/webhooks/edna/incoming', ['id' => (string) (91000 + DB::table('edna_incoming_events')->count()),
        'subjectId' => 2423, 'subscriber' => ['identifier' => $phone], 'receivedAt' => now()->toIso8601String(),
        'messageContent' => ['type' => 'TEXT', 'text' => $text]], ['Authorization' => 'Token web-form-test'])->assertOk();
    $event = DB::table('edna_incoming_events')->latest('id')->first();
    (new ReceiveEdnaInKestra($event->id))->handle();

    return $event;
}

test('a verified pending form skips intake and follows its web CRM result idempotently', function () {
    $input = continuationForm();
    $reference = app(WebFormReceipt::class)->register($input);
    $event = continuationEntry('Ya completé el formulario (solicitud: '.$reference.')');
    (new ReceiveEdnaInKestra($event->id))->handle();
    $row = DB::table('web_form_continuations')->first();
    expect($row->state)->toBe('waiting')->and($row->submission_id)->toBe($input['_journey_links']['submission_id'])
        ->and(DB::table('edna_flow_sends')->count())->toBe(0)->and(DB::table('edna_intake_admissions')->count())->toBe(0);
    app(WebFormReceipt::class)->result($input, ['ok' => true, 'lead_id' => '700', 'contact_id' => '710'], true);
    expect(DB::table('web_form_continuations')->count())->toBe(1)
        ->and(DB::table('web_form_continuations')->first()->state)->toBe('ready')
        ->and(DB::table('web_form_continuations')->first()->lead_id)->toBe('700');
    Queue::assertNotPushed(SendEdnaFlow::class);
    Http::assertNothingSent();
});

test('an existing synced form continues without another form or CRM request', function () {
    $input = continuationForm();
    $reference = app(WebFormReceipt::class)->register($input);
    app(WebFormReceipt::class)->result($input, ['ok' => true, 'lead_id' => '700'], true);
    continuationEntry('Hola (solicitud: '.$reference.')');
    expect(DB::table('web_form_continuations')->first()->reason)->toBe('web_form_already_processed')
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    Http::assertNothingSent();
});

test('unverified claims and ambiguous shared phones never choose a CRM lead', function (string $kind) {
    $input = continuationForm();
    $reference = app(WebFormReceipt::class)->register($input);
    $text = match ($kind) {
        'missing' => 'Hola',
        'invalid' => '(solicitud: '.str_repeat('x', 32).')',
        'duplicate' => '(solicitud: '.$reference.') (solicitud: '.$reference.')',
        default => '(solicitud: '.$reference.')',
    };
    if ($kind === 'shared') {
        app(WebFormReceipt::class)->register(continuationForm('20123456786'));
        $text = 'Hola';
    } elseif ($kind === 'expired') {
        DB::table('web_form_receipts')->update(['expires_at' => now()->subSecond()]);
    } elseif ($kind === 'failed') {
        app(WebFormReceipt::class)->failed($input);
    }
    continuationEntry($text, $kind === 'wrong_phone' ? '5493510000001' : '5493510000000');
    $row = DB::table('web_form_continuations')->first();
    expect($row->state)->toBe('review')->and($row->lead_id)->toBeNull()
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
    if ($kind !== 'failed') {
        expect($row->submission_id)->toBeNull();
    }
    Http::assertNothingSent();
})->with(['missing', 'invalid', 'duplicate', 'shared', 'expired', 'wrong_phone', 'failed']);

test('the post-form phrase without server evidence goes to review', function () {
    continuationEntry('Hola, acabo de completar el formulario en la web');
    expect(DB::table('web_form_continuations')->first()->reason)->toBe('web_form_claim_unverified')
        ->and(DB::table('edna_flow_sends')->count())->toBe(0);
});

test('a direct new inquiry still reserves v3 once', function () {
    continuationEntry();
    continuationEntry('Quería consultar');
    expect(DB::table('edna_flow_sends')->count())->toBe(1)
        ->and(DB::table('edna_intake_admissions')->count())->toBe(1);
    Queue::assertPushed(SendEdnaFlow::class, 1);
});

test('a web form accepted after reservation cancels the queued flow before schedule', function () {
    continuationEntry();
    $send = DB::table('edna_flow_sends')->first();
    app(WebFormReceipt::class)->register(continuationForm());
    Http::fake(['app.edna.io/api/cascade/get-all' => Http::response([['id' => 2557, 'status' => 'ACTIVE',
        'stages' => [['subject' => ['id' => 2423, 'locked' => false]]]]])]);
    (new SendEdnaFlow($send->id))->handle();
    (new SendEdnaFlow($send->id))->handle();
    expect(DB::table('edna_flow_sends')->find($send->id)->state)->toBe('cancelled')
        ->and(DB::table('edna_flow_sends')->find($send->id)->reason)->toBe('web_form_reference_required')
        ->and(DB::table('edna_intake_pilots')->first()->admitted)->toBe(1);
    Http::assertNotSent(fn ($r) => str_ends_with($r->url(), 'cascade/schedule'));
});

function redundantWebRequest(): object
{
    $event = continuationEntry();
    $send = DB::table('edna_flow_sends')->first();
    $input = continuationForm();
    app(WebFormReceipt::class)->register($input);
    DB::table('web_form_receipts')->update(['received_at' => now()->subMinute()]);
    app(WebFormReceipt::class)->result($input, ['ok' => true, 'lead_id' => '700', 'contact_id' => '710'], true);
    $proof = ['version' => 1, 'source' => 'bitrix_openline_session', 'verified' => true, 'lead_id' => '700',
        'evidence' => 'external_message_id', 'entry_event_id' => (int) $event->id, 'entry_message_id' => $event->message_id];
    DB::table('edna_intake_bindings')->insert(['flow_send_id' => $send->id, 'case_id' => $send->request_id,
        'entry_event_id' => $event->id, 'lead_id' => '700', 'state' => 'verified', 'proof' => json_encode($proof),
        'created_at' => now(), 'updated_at' => now()]);
    DB::table('edna_flow_sends')->where('id', $send->id)->update(['state' => 'completed', 'response_event_id' => $event->id]);
    $id = DB::table('edna_intake_requests')->insertGetId(['flow_send_id' => $send->id, 'response_event_id' => $event->id,
        'answer' => Crypt::encryptString(json_encode(['cuil' => '20301234563'])), 'received_at' => now(),
        'state' => 'review', 'reason' => 'bound_management_requires_review', 'lead_id' => '700',
        'created_at' => now(), 'updated_at' => now()]);

    return DB::table('edna_intake_requests')->find($id);
}

test('historical reconciliation is local, preserves the answer and transport, and applies once', function () {
    $request = redundantWebRequest();
    $before = (array) DB::table('edna_flow_sends')->first();
    $service = app(WebFormContinuation::class);
    expect($service->settleRedundant($request->id)['applied'])->toBeFalse()
        ->and(DB::table('edna_intake_requests')->first()->state)->toBe('review');
    $this->artisan('edna:web-forms', ['action' => 'reconcile', '--request' => [$request->id], '--apply' => true])->assertFailed();
    $this->artisan('edna:web-forms', ['action' => 'reconcile', '--request' => [$request->id], '--apply' => true,
        '--confirmed-crm-continuity' => true])->assertSuccessful();
    expect($service->settleRedundant($request->id, true))->toBeNull()
        ->and(DB::table('edna_intake_requests')->first()->state)->toBe('synced')
        ->and(DB::table('edna_intake_requests')->first()->answer)->toBe($request->answer)
        ->and((array) DB::table('edna_flow_sends')->first())->toBe($before)
        ->and(DB::table('web_form_continuations')->first()->previous_reason)->toBe('bound_management_requires_review');
    Http::assertNothingSent();
});

test('reconciliation rejects conflicting identities leads timings bindings and uncertain writes', function (string $kind) {
    $request = redundantWebRequest();
    match ($kind) {
        'identity' => DB::table('web_form_receipts')->update(['identity_hash' => app(WebFormReceipt::class)->identityHash('20123456786')]),
        'lead' => DB::table('web_form_receipts')->update(['lead_id' => '701']),
        'phone' => DB::table('web_form_receipts')->update(['phone_hash' => str_repeat('a', 64)]),
        'late' => DB::table('web_form_receipts')->update(['received_at' => now()->addMinute()]),
        'binding' => DB::table('edna_intake_bindings')->update(['state' => 'pending']),
        'contact' => DB::table('edna_intake_requests')->update(['contact_id' => '710']),
        'unknown' => DB::table('edna_intake_requests')->update(['state' => 'unknown']),
        'not_synced' => DB::table('web_form_receipts')->update(['state' => 'uncertain']),
    };
    expect(app(WebFormContinuation::class)->settleRedundant($request->id, true))->toBeNull();
    Http::assertNothingSent();
})->with(['identity', 'lead', 'phone', 'late', 'binding', 'contact', 'unknown', 'not_synced']);

test('journal import previews without writes and preserves the original server evidence on repeated apply', function (bool $conflict) {
    $root = sys_get_temp_dir().'/web-form-import-'.Str::uuid();
    mkdir($root);
    mkdir($root.'/testing');
    config()->set('journey.root', $root);
    config()->set('journey.environment', 'testing');
    $input = continuationForm();
    $id = $input['_journey_links']['submission_id'];
    $hash = (new AttributionJourney)->phoneHash($input['celular']);
    $links = ['submission_id' => $id, 'phone_hash' => $hash];
    $events = [
        ['type' => 'form.received', 'occurred_at' => now()->subMinute()->toISOString(), 'links' => $links, 'data' => ['input' => $input]],
        ['type' => 'form.persistence_result', 'occurred_at' => now()->toISOString(),
            'links' => $links + ['lead_id' => '700', 'contact_id' => '710'],
            'data' => ['http_status' => 200, 'result' => ['ok' => true, 'lead_id' => '700']]],
    ];
    if ($conflict) {
        $events[] = ['type' => 'form.persistence_result', 'occurred_at' => now()->addSecond()->toISOString(),
            'links' => $links + ['lead_id' => '701'], 'data' => ['result' => ['ok' => true, 'lead_id' => '701']]];
    }
    $file = $root.'/testing/events-2026-11-06.jsonl';
    file_put_contents($file, implode("\n", array_map(fn ($v) => json_encode($v), $events))."\n");
    try {
        $args = ['action' => 'import', '--date' => ['2026-11-06']];
        $this->artisan('edna:web-forms', $args)->assertSuccessful();
        expect(DB::table('web_form_receipts')->count())->toBe(0);
        $this->artisan('edna:web-forms', $args + ['--apply' => true])->assertSuccessful();
        $this->artisan('edna:web-forms', $args + ['--apply' => true])->assertSuccessful();
        $row = DB::table('web_form_receipts')->first();
        expect(DB::table('web_form_receipts')->count())->toBe(1)
            ->and($row->id)->toBe($id)->and($row->state)->toBe($conflict ? 'uncertain' : 'synced')
            ->and($row->lead_id)->toBe($conflict ? null : '700')->and($row->reference_hash)->toBeNull();
        Queue::assertNothingPushed();
        Http::assertNothingSent();
    } finally {
        unlink($file);
        rmdir($root.'/testing');
        rmdir($root);
    }
})->with([false, true]);
