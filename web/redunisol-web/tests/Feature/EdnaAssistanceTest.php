<?php

use App\Jobs\ProcessEdnaAssistance;
use App\Jobs\ReceiveEdnaInKestra;
use App\Jobs\ReconcileEdnaAssistance;
use App\Jobs\SendEdnaAssistance;
use App\Services\EdnaAssistance;
use App\Services\EdnaFlowRouter;
use App\Services\WhatsAppSalesContext;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 10, 19)->setTime(12, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('a', 32)));
    config()->set('edna', ['enabled' => true, 'assistance_enabled' => true, 'assistance_send_enabled' => true,
        'assistance_crm_enabled' => false, 'assistance_recipients' => ['5493511234567'],
        'assistance_start_at' => now()->subDay()->toIso8601String(), 'assistance_delay_minutes' => 30,
        'subject_id' => '2423', 'api_key' => 'outbound-test-key', 'kestra_url' => 'https://kestra.example.test/incoming']);
    Http::preventStrayRequests();
    Queue::fake();
});

function assistanceRouterFixture(array $changes = []): int
{
    $flow = DB::table('edna_flow_sends')->insertGetId(['request_id' => (string) Str::uuid(), 'entry_event_id' => 999,
        'scope' => (new EdnaFlowRouter)->scope('2423', '5493511234567'), 'subject_id' => '2423', 'cascade_id' => '2557', 'flow_id' => EdnaFlowRouter::FLOW_ID,
        'recipient' => Crypt::encryptString('5493511234567'), 'state' => 'completed',
        'entry_received_at' => now()->subHour(), 'created_at' => now()->subHour(), 'updated_at' => now()]);

    return DB::table('edna_router_results')->insertGetId($changes + [
        'flow_send_id' => $flow, 'response_event_id' => 888, 'province' => 'cordoba', 'situation' => 'jubilado_pensionado',
        'segment' => 'cordoba_jubilado', 'landing_url' => 'https://redunisol.com.ar/', 'message_text' => 'landing',
        'response_received_at' => now()->subMinutes(32), 'request_id' => (string) Str::uuid(),
        'state' => 'confirmed', 'send_started_at' => now()->subMinutes(31), 'created_at' => now(), 'updated_at' => now(),
    ]);
}

function assistanceCaseFixture(array $changes = []): object
{
    assistanceRouterFixture();
    (new EdnaAssistance)->poll(true);
    $id = DB::table('edna_assistance_cases')->value('id');
    if ($changes) {
        DB::table('edna_assistance_cases')->where('id', $id)->update($changes);
    }

    return DB::table('edna_assistance_cases')->find($id);
}

function assistanceHttp(bool $timeout = false): void
{
    test()->sendAttempts = 0;
    Http::fake([
        'app.edna.io/api/cascade/get-all' => Http::response([['id' => 2557, 'status' => 'ACTIVE',
            'stages' => [['subject' => ['id' => 2423, 'locked' => false]]]]]),
        'app.edna.io/api/cascade/schedule' => function ($r) use ($timeout) {
            test()->sendAttempts++;
            if ($timeout) {
                throw new ConnectionException('uncertain');
            }

            return Http::response(['requestId' => $r['requestId']]);
        },
    ]);
}

test('disabled assistance never reserves work or calls external systems', function () {
    config()->set('edna.assistance_enabled', false);
    expect((new EdnaAssistance)->poll(true))->toBe(['enabled' => false, 'candidates' => 0, 'reserved' => 0]);
    Http::assertNothingSent();
    Queue::assertNothingPushed();
});

test('empty pilot list denies everyone even with send and CRM flags enabled', function () {
    assistanceRouterFixture();
    config()->set('edna.assistance_recipients', []);
    config()->set('edna.assistance_crm_enabled', true);
    expect((new EdnaAssistance)->allowed('5493511234567'))->toBeFalse();
    (new EdnaAssistance)->poll(true);
    expect(DB::table('edna_assistance_cases')->count())->toBe(0);
    Http::assertNothingSent();
});

test('poll is a read only preview unless dispatch and sending are enabled', function () {
    assistanceRouterFixture();
    expect((new EdnaAssistance)->poll()['candidates'])->toBe(1);
    expect(DB::table('edna_assistance_cases')->count())->toBe(0);
    config()->set('edna.assistance_send_enabled', false);
    (new EdnaAssistance)->poll(true);
    expect(DB::table('edna_assistance_cases')->count())->toBe(0);
    Queue::assertNothingPushed();
});

test('only confirmed landings after activation qualify and polling reserves once', function () {
    assistanceRouterFixture(['state' => 'unknown']);
    (new EdnaAssistance)->poll(true);
    expect(DB::table('edna_assistance_cases')->count())->toBe(0);
    DB::table('edna_router_results')->update(['state' => 'confirmed']);
    expect((new EdnaAssistance)->poll(true)['reserved'])->toBe(1);
    expect((new EdnaAssistance)->poll(true)['reserved'])->toBe(0);
    expect(DB::table('edna_assistance_cases')->count())->toBe(1);
});

test('a form or existing commercial management suppresses the rescue', function () {
    $case = assistanceCaseFixture();
    $this->mock(WhatsAppSalesContext::class)->shouldReceive('resolve')->once()
        ->with('5493511234567', Mockery::on(fn ($r) => isset($r['any_form_since'])))
        ->andReturn(['evidence' => [['kind' => 'form']]]);
    (new SendEdnaAssistance($case->id))->handle();
    expect(DB::table('edna_assistance_cases')->find($case->id)->state)->toBe('suppressed');
    Http::assertNothingSent();
});

test('the timer never sends before thirty minutes', function () {
    $case = assistanceCaseFixture(['due_at' => now()->addMinute()]);
    (new SendEdnaAssistance($case->id))->handle();
    expect(DB::table('edna_assistance_cases')->find($case->id)->state)->toBe('waiting');
    Http::assertNothingSent();
});

test('the confirmed pilot schedules only one Flow and uses the assisted copy', function () {
    $case = assistanceCaseFixture();
    $this->mock(WhatsAppSalesContext::class)->shouldReceive('resolve')->once()->andReturn(['evidence' => []]);
    assistanceHttp();
    (new SendEdnaAssistance($case->id))->handle();
    (new SendEdnaAssistance($case->id))->handle();
    Http::assertSentCount(2);
    Http::assertSent(fn ($r) => str_contains($r->url(), 'cascade/schedule')
        && $r['content']['whatsappContent']['flowId'] === 1806329230567984
        && str_contains($r['content']['whatsappContent']['text'], 'aunque no tengas'));
});

test('an ambiguous send acknowledgement is reconciled and never resent', function () {
    $case = assistanceCaseFixture();
    $this->mock(WhatsAppSalesContext::class)->shouldReceive('resolve')->once()->andReturn(['evidence' => []]);
    assistanceHttp(true);
    (new SendEdnaAssistance($case->id))->handle();
    expect(DB::table('edna_assistance_cases')->find($case->id)->state)->toBe('unknown');
    (new SendEdnaAssistance($case->id))->handle();
    expect(test()->sendAttempts)->toBe(1);
    Queue::assertPushed(ReconcileEdnaAssistance::class);
});

test('CRM preview preserves the encrypted optional answer without contacting CRM', function () {
    $case = assistanceCaseFixture(['state' => 'answered', 'answer' => Crypt::encryptString(json_encode(['organismo' => 'ayuda'])),
        'decision' => json_encode(['action' => 'review'])]);
    (new ProcessEdnaAssistance($case->id))->handle();
    expect(DB::table('edna_assistance_cases')->find($case->id)->crm_state)->toBe('preview');
    Http::assertNothingSent();
});

test('a processing timeout is retained for reconciliation without automatic replay', function () {
    $this->mock(WhatsAppSalesContext::class)->shouldReceive('resolve')->once()->andReturn(['evidence' => []]);
    config()->set('edna.assistance_crm_enabled', true);
    config()->set('edna.assistance_processing_url', 'https://kestra.example.test/intake');
    $case = assistanceCaseFixture(['state' => 'answered', 'answer' => Crypt::encryptString(json_encode(['organismo' => 'ayuda'])),
        'decision' => json_encode(['action' => 'review'])]);
    $this->processingAttempts = 0;
    Http::fake(['kestra.example.test/*' => function () {
        test()->processingAttempts++;
        throw new ConnectionException('unknown');
    }]);
    (new ProcessEdnaAssistance($case->id))->handle();
    (new ProcessEdnaAssistance($case->id))->handle();
    expect(DB::table('edna_assistance_cases')->find($case->id)->crm_state)->toBe('unknown');
    expect($this->processingAttempts)->toBe(1);
});

test('verified assisted callback is processed once and uses the separate queue', function () {
    $case = assistanceCaseFixture(['state' => 'confirmed', 'send_started_at' => now()->subMinute(), 'outgoing_message_id' => '900']);
    $payload = ['subjectId' => '2423', 'id' => '901', 'subscriber' => ['identifier' => '5493511234567'],
        'receivedAt' => now()->toIso8601String(), 'replyOutMessageId' => '900', 'replyOutMessageExternalRequestId' => $case->request_id,
        'messageContent' => ['type' => 'FLOW', 'text' => json_encode(['organismo' => 'ayuda', 'cuil_ayuda' => '', 'email_ayuda' => ''])]];
    $event = DB::table('edna_incoming_events')->insertGetId(['subject_id' => '2423', 'message_id' => '901',
        'payload' => Crypt::encryptString(json_encode($payload)), 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()]);
    Http::fake(['kestra.example.test/*' => fn ($r) => Http::response(['ok' => true, 'kind' => 'jubilados_assistance',
        'event_key' => '2423:901', 'request_id' => $case->request_id,
        'assistance_result' => json_encode(['version' => 'jubilados-assistance-v1', 'action' => 'review'])])]);
    (new ReceiveEdnaInKestra($event))->handle();
    (new ReceiveEdnaInKestra($event))->handle();
    Http::assertSentCount(1);
    expect(DB::table('edna_incoming_events')->find($event)->outcome)->toBe('jubilados_assistance');
    expect(DB::table('edna_assistance_cases')->find($case->id)->state)->toBe('answered');
    Queue::assertPushed(ProcessEdnaAssistance::class, 1);
});

test('new management after the Flow prevents CRM writes', function () {
    config()->set('edna.assistance_crm_enabled', true);
    $case = assistanceCaseFixture(['state' => 'answered', 'answer' => Crypt::encryptString('{"organismo":"ayuda"}'),
        'decision' => json_encode(['action' => 'review'])]);
    $this->mock(WhatsAppSalesContext::class)->shouldReceive('resolve')->once()->andReturn(['evidence' => [['kind' => 'form']]]);
    (new ProcessEdnaAssistance($case->id))->handle();
    expect(DB::table('edna_assistance_cases')->find($case->id)->reason)->toBe('management_after_assistance');
    Http::assertNothingSent();
});

test('returning to the form sends the final branch landing only once', function () {
    $case = assistanceCaseFixture(['state' => 'answered', 'answer' => Crypt::encryptString('{"organismo":"caja_cordoba"}'),
        'decision' => json_encode(['action' => 'landing', 'organism' => 'caja_cordoba'])]);
    (new ProcessEdnaAssistance($case->id))->handle();
    (new ProcessEdnaAssistance($case->id))->handle();
    $case = DB::table('edna_assistance_cases')->find($case->id);
    expect($case->link_state)->toBe('waiting');
    expect(Crypt::decryptString($case->link_text))->toContain('cordoba_jubilado_caja');
    assistanceHttp();
    (new SendEdnaAssistance($case->id, true))->handle();
    (new SendEdnaAssistance($case->id, true))->handle();
    expect($this->sendAttempts)->toBe(1);
});

test('a web form accepted into the queue cancels rescue before the lead reaches Bitrix', function () {
    $case = assistanceCaseFixture();
    config()->set('attribution.enabled', false);
    config()->set('services.kestra.prequalification_webhook_url', 'https://kestra.example.test/prequalification');
    Http::fake(['kestra.example.test/*' => Http::response(['ok' => true, 'prequalified' => true])]);
    $this->postJson('/api/form-submissions', ['celular' => '3511234567', 'landing_slug' => 'jubilados-cordoba', 'terminos' => true])->assertOk();
    expect(DB::table('edna_assistance_form_receipts')->count())->toBe(1);
    (new SendEdnaAssistance($case->id))->handle();
    expect(DB::table('edna_assistance_cases')->find($case->id)->reason)->toBe('form_queued_or_submitted');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'app.edna.io'));
});

test('a form arriving during the CRM preflight still prevents the outbound POST', function () {
    $case = assistanceCaseFixture();
    $this->mock(WhatsAppSalesContext::class)->shouldReceive('resolve')->once()->andReturnUsing(function () {
        (new EdnaAssistance)->recordForm('3511234567');

        return ['evidence' => []];
    });
    assistanceHttp();
    (new SendEdnaAssistance($case->id))->handle();
    expect(DB::table('edna_assistance_cases')->find($case->id)->state)->toBe('suppressed');
    expect($this->sendAttempts)->toBe(0);
});

test('a second router cycle cannot send assistance after an earlier send attempt', function () {
    $case = assistanceCaseFixture(['state' => 'confirmed', 'send_started_at' => now()->subMinute()]);
    $other = (array) $case;
    unset($other['id']);
    $id = DB::table('edna_assistance_cases')->insertGetId(array_replace($other, [
        'router_result_id' => 987654, 'request_id' => (string) Str::uuid(), 'state' => 'waiting', 'send_started_at' => null,
    ]));
    $this->mock(WhatsAppSalesContext::class)->shouldReceive('resolve')->once()->andReturn(['evidence' => []]);
    assistanceHttp();
    (new SendEdnaAssistance($id))->handle();
    expect(DB::table('edna_assistance_cases')->find($id)->reason)->toBe('assistance_previously_started');
    expect($this->sendAttempts)->toBe(0);
});

test('the process command cannot promote a preview while the pilot is disabled', function () {
    $case = assistanceCaseFixture(['crm_state' => 'preview']);
    config()->set('edna.assistance_crm_enabled', true);
    config()->set('edna.assistance_enabled', false);
    $this->artisan('edna:assistance', ['action' => 'process', 'case' => $case->id, '--dispatch' => true])->assertFailed();
    expect(DB::table('edna_assistance_cases')->find($case->id)->crm_state)->toBe('preview');
    Queue::assertNotPushed(ProcessEdnaAssistance::class);
});
