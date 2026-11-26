<?php

use App\Jobs\RequalifyEdnaWebDeclaration;
use App\Services\AttributionJourney;
use App\Services\WebFormReceipt;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

function webRevisionFixture(): array
{
    $case = '5320b977-9095-4eaf-8c91-9b4ee1671b50';
    $submission = '4dfbc372-a680-4062-9f33-d22784e145ef';
    $phone = '5493510000000';
    $answer = ['provincia' => 'cordoba', 'situacion_cordoba' => 'docente', 'banco_cordoba' => 'bancor',
        'cuil' => '20123456786', 'email' => 'fixture@example.org'];
    $dates = ['created_at' => now(), 'updated_at' => now()];
    config(['app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
        'edna.intake_processing_url' => 'https://example.test/bitrix24_whatsapp_intake/key']);
    DB::table('web_form_receipts')->insert($dates + ['id' => $submission, 'state' => 'synced', 'source' => 'web_server',
        'phone_hash' => (new AttributionJourney)->phoneHash($phone), 'identity_hash' => (new WebFormReceipt)->identityHash($answer['cuil']),
        'received_at' => now(), 'expires_at' => now()->addDay(), 'lead_id' => '7', 'contact_id' => '11']);
    $send = DB::table('edna_flow_sends')->insertGetId($dates + ['request_id' => $case, 'entry_event_id' => 15,
        'scope' => 'web-fixture', 'subject_id' => '2423', 'cascade_id' => '2557', 'flow_id' => '950118281197789',
        'recipient' => Crypt::encryptString($phone), 'state' => 'completed', 'entry_received_at' => now(), 'response_event_id' => 16]);
    $id = DB::table('edna_intake_requests')->insertGetId($dates + ['flow_send_id' => $send, 'response_event_id' => 16,
        'answer' => Crypt::encryptString(json_encode($answer, JSON_THROW_ON_ERROR)), 'received_at' => now(),
        'state' => 'pending_requalification', 'reason' => 'fresh_web_revision', 'web_submission_id' => $submission,
        'lead_id' => '7', 'contact_id' => '11']);
    Http::preventStrayRequests();

    return [$id, $submission];
}

test('web amendment records scoped decision once and preserves a concurrently changed CRM receipt', function (bool $changeReceipt) {
    [$id, $submission] = webRevisionFixture();
    Http::fake(function ($r) use ($changeReceipt, $submission) {
        if ($changeReceipt) {
            DB::table('web_form_receipts')->where('id', $submission)->update(['state' => 'uncertain']);
        }

        return Http::response(array_intersect_key($r->data(), array_flip(['contract', 'case_id', 'web_submission_id', 'input_digest']))
            + ['ok' => true, 'write_attempted' => false, 'action' => 'qualified', 'reason' => 'qualified', 'rule_version' => 'test-1']);
    });
    $job = new RequalifyEdnaWebDeclaration($id);
    $job->handle();
    $job->handle();
    Http::assertSentCount(1);
    $body = json_decode(Http::recorded()->first()[0]->body(), true, 16, JSON_THROW_ON_ERROR);
    expect(array_keys($body['fields']))->toBe(['banco_cordoba', 'provincia', 'situacion_cordoba'])
        ->and(array_intersect(['cuil', 'email', 'phone', 'lead_id', 'contact_id', 'answer'], array_keys($body)))->toBe([]);
    $request = DB::table('edna_intake_requests')->find($id);
    $decision = json_decode($request->web_prequalification, true, 16, JSON_THROW_ON_ERROR);
    expect($decision)->toMatchArray(['scope' => 'declared_data_prequalification', 'outcome' => 'qualified',
        'rule_version' => 'test-1', 'applies_to_web_request' => ! $changeReceipt, 'credit_checks' => 'not_evaluated', 'crm_action' => 'none'])
        ->and($request->state)->toBe('synced')
        ->and(DB::table('edna_intake_chat_routes')->count())->toBe(0);
})->with([false, true]);

test('web amendment with an uncertain acknowledgement remains retryable on the same receipt', function () {
    [$id] = webRevisionFixture();
    Http::fake([config('edna.intake_processing_url') => Http::response(['ok' => true, 'input_digest' => 'different'])]);
    $job = new RequalifyEdnaWebDeclaration($id);
    expect(fn () => $job->handle())->toThrow(RuntimeException::class);
    $job->failed(null);
    $request = DB::table('edna_intake_requests')->find($id);
    expect($request->state)->toBe('pending_requalification')->and($request->web_prequalification)->toBeNull()
        ->and($request->reason)->toBe('fresh_prequalification_unavailable');
});
