<?php

use App\Actions\SubmitFormToKestra;
use App\Jobs\ReconcileWebFormAcknowledgement;
use App\Services\EdnaBitrix;
use App\Services\MetaConversionsApiService;
use App\Services\WebFormReceipt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

beforeEach(function () {
    config(['app.key' => 'base64:'.base64_encode(str_repeat('w', 32))]);
    $this->id = (string) Str::uuid();
    $this->form = ['_journey_links' => ['submission_id' => $this->id], 'cuil' => '20123456783', 'celular' => '5491112345678'];
    $this->receipts = new WebFormReceipt;
    $this->receipts->register($this->form);
});

it('claims the CRM write once and records an independent verification job', function () {
    expect($this->receipts->claimDispatch($this->form))->toBeTrue()
        ->and($this->receipts->claimDispatch($this->form))->toBeFalse()
        ->and(DB::table('jobs')->where('queue', 'web-forms-reconcile')->count())->toBe(1);
    $this->receipts->failed($this->form);
    expect(DB::table('web_form_receipts')->value('state'))->toBe('uncertain');
});

it('recovers an exact lead after a lost acknowledgement without writing to Bitrix', function () {
    $this->receipts->claimDispatch($this->form);
    $this->receipts->failed($this->form);
    $crm = Mockery::mock(EdnaBitrix::class);
    $crm->shouldReceive('call')->once()->with('crm.lead.list', Mockery::on(fn ($q) => $q['filter'] ===
        ['=ORIGINATOR_ID' => 'redunisol-web', '=ORIGIN_ID' => $this->id]))
        ->andReturn([['ID' => '13', 'CONTACT_ID' => '14', 'ORIGINATOR_ID' => 'redunisol-web',
            'ORIGIN_ID' => $this->id, 'UF_CRM_1693840106704' => '20123456783.00']]);
    expect($this->receipts->identityHash('2012345678.3'))->toBeNull();
    $job = new ReconcileWebFormAcknowledgement($this->form);
    $job->handle($crm, $this->receipts);
    $job->handle($crm, $this->receipts);
    $this->receipts->failed($this->form);
    expect(DB::table('web_form_receipts')->value('state'))->toBe('synced')
        ->and(DB::table('web_form_receipts')->value('lead_id'))->toBe('13');
});

it('preserves uncertainty for empty, duplicate or inconsistent CRM evidence', function (string $scenario) {
    $this->receipts->claimDispatch($this->form);
    $this->receipts->failed($this->form);
    $lead = ['ID' => '13', 'CONTACT_ID' => '14', 'ORIGINATOR_ID' => 'redunisol-web', 'ORIGIN_ID' => $this->id,
        'UF_CRM_1693840106704' => $scenario === 'different identity' ? '27000000009' : '20123456783'];
    $rows = match ($scenario) {
        'empty' => [], 'duplicate' => [$lead, $lead], default => [$lead]
    };
    $crm = Mockery::mock(EdnaBitrix::class);
    $crm->shouldReceive('call')->once()->with('crm.lead.list', Mockery::type('array'))->andReturn($rows);
    expect(fn () => (new ReconcileWebFormAcknowledgement($this->form))->handle($crm, $this->receipts))
        ->toThrow(RuntimeException::class);
    expect(DB::table('web_form_receipts')->value('state'))->toBe('uncertain');
})->with(['empty', 'duplicate', 'different identity']);

it('grants one irreversible CRM write to the exact payload and isolates scope', function () {
    config(['services.bitrix_routing.allocation_token' => 'internal', 'chat_response.scope' => 'test-scope']);
    $url = '/api/internal/web-form-receiver/claim';
    $payload = (new SubmitFormToKestra)->guardedPayload($this->form, []);
    $body = ['submission_id' => $this->id, 'scope' => 'test-scope', 'digest' => hash('sha256', $payload)];
    $this->receipts->claimDispatch($this->form, $payload);
    $this->postJson($url, $body)->assertUnauthorized();
    $this->withToken('internal')->postJson($url, array_replace($body, ['scope' => 'another']))->assertForbidden();
    $this->postJson($url, array_replace($body, ['digest' => str_repeat('b', 64)]))->assertJsonPath('state', 'denied');
    $this->postJson($url, $body)->assertJsonPath('state', 'granted');
    $this->travel(5)->hours();
    $this->postJson($url, $body)->assertJsonPath('state', 'in_progress');
    expect($this->receipts->result($this->form, ['ok' => true, 'lead_id' => '9'], true))->toBeFalse();
    $this->receipts->result($this->form, ['ok' => true, 'lead_id' => '9', 'contact_id' => '3'], true);
    $this->postJson($url, $body)->assertJsonPath('state', 'synced')->assertJsonPath('lead_id', '9');
    expect($this->receipts->result($this->form, ['ok' => true, 'lead_id' => '9', 'contact_id' => '4'], true))->toBeFalse();
    $this->postJson($url, $body)->assertJsonPath('state', 'denied');
});

it('retries an unstarted recipient using the original bytes, preserves conversions and stops after proof', function () {
    $url = 'https://kestra.example.test/webhook';
    config(['services.kestra.form_webhook_url' => $url]);
    $bundle = (new SubmitFormToKestra)->guardedPayload($this->form, []);
    $this->receipts->claimDispatch($this->form, $bundle, true);
    $meta = Mockery::mock(MetaConversionsApiService::class);
    $meta->shouldReceive('sendLead')->once()->with(Mockery::on(fn ($in) => $in['meta_event_id'] === $this->id), ['ip' => '192.0.2.1']);
    $this->app->instance(MetaConversionsApiService::class, $meta);
    Http::fake([$url => function ($request) use ($bundle) {
        expect($request->data())->toBe(['web_crm_delivery_v1' => $bundle]);
        expect($this->receipts->claimWrite($this->id, hash('sha256', $bundle)))->toBe(['state' => 'granted']);

        return Http::response(['ok' => true, 'lead_id' => '13', 'contact_id' => '14']);
    }]);
    $job = new ReconcileWebFormAcknowledgement($this->form, true, ['ip' => '192.0.2.1'], $bundle);
    $crm = Mockery::mock(EdnaBitrix::class);
    $crm->shouldNotReceive('call');
    $job->handle($crm, $this->receipts);
    $job->handle($crm, $this->receipts);
    Http::assertSentCount(1);
    expect(DB::table('web_form_receipts')->value('state'))->toBe('synced');
});

it('never resends after a granted write even if the CRM lookup is empty', function () {
    $bundle = (new SubmitFormToKestra)->guardedPayload($this->form, []);
    $this->receipts->claimDispatch($this->form, $bundle);
    $this->receipts->claimWrite($this->id, hash('sha256', $bundle));
    $crm = Mockery::mock(EdnaBitrix::class);
    $crm->shouldReceive('call')->once()->andReturn([]);
    Http::fake();
    expect(fn () => (new ReconcileWebFormAcknowledgement($this->form, false, [], $bundle))->handle($crm, $this->receipts))
        ->toThrow(RuntimeException::class);
    $this->receipts->failed($this->form, finalCheck: true);
    expect(DB::table('web_form_receipts')->value('state'))->toBe('uncertain');
    Http::assertNothingSent();
});

it('distinguishes exhausted deliveries before the first write and refuses late executions', function () {
    $bundle = (new SubmitFormToKestra)->guardedPayload($this->form, []);
    $this->receipts->claimDispatch($this->form, $bundle);
    $this->receipts->failed($this->form, finalCheck: true);
    $this->receipts->failed($this->form); // a late negative acknowledgement cannot reopen the right to write
    $this->receipts->result($this->form, ['ok' => false], false);
    expect(DB::table('web_form_receipts')->value('state'))->toBe('failed')
        ->and($this->receipts->claimWrite($this->id, hash('sha256', $bundle)))->toBe(['state' => 'denied']);
});

it('keeps conflicting acknowledgements quarantined across subsequent responses', function () {
    $this->receipts->claimDispatch($this->form);
    foreach (['12', '13', '13'] as $lead) {
        $this->receipts->result($this->form, ['ok' => true, 'lead_id' => $lead, 'contact_id' => '1'], true);
    }
    expect(DB::table('web_form_receipts')->value('state'))->toBe('uncertain')
        ->and(DB::table('web_form_receipts')->value('crm_ack_conflict_at'))->not->toBeNull();
});

it('pins the sender format when queued and deduplicates conversions across rollout and rollback', function (bool $v1) {
    config(['services.kestra.form_webhook_url' => 'https://kestra.example.test/form']);
    if ($v1) {
        config(['services.kestra.guarded_form_delivery' => true]);
    }
    $queued = serialize(new \App\Jobs\PersistFormSubmission($this->form, true, reconcileAcknowledgement: true));
    config(['services.kestra.guarded_form_delivery' => ! $v1]);
    $meta = Mockery::mock(MetaConversionsApiService::class);
    $meta->shouldReceive('sendLead')->once();
    app()->instance(MetaConversionsApiService::class, $meta);
    Http::fake(['https://kestra.example.test/form' => function ($request) use ($v1) {
        $wire = $request->data();
        if ($v1) {
            expect(array_keys($wire))->toBe(['web_crm_delivery_v1']);
            $this->receipts->claimWrite($this->id, hash('sha256', $wire['web_crm_delivery_v1']));
        } else {
            expect($wire['web_submission_id'])->toBe($this->id)->and($wire)->not->toHaveKey('web_crm_delivery_v1');
        }

        return Http::response(['ok' => true, 'lead_id' => '13', 'contact_id' => '14']);
    }]);
    $job = unserialize($queued);
    $job->handle(new SubmitFormToKestra, $meta);
    $job->handle(new SubmitFormToKestra, $meta);
    (new ReconcileWebFormAcknowledgement($this->form, true))->handle(Mockery::mock(EdnaBitrix::class), $this->receipts);
    Http::assertSentCount(1);
    expect(DB::table('web_form_receipts')->value('state'))->toBe('synced');
})->with(['default legacy job on upgraded worker' => [false], 'v1 job on rolled back sender' => [true]]);
