<?php

use App\Services\AttributionJourney;
use App\Services\EdnaIntake;
use App\Services\EdnaMessageBinding;
use App\Services\EdnaOrganicProfile;
use App\Services\WebChatContinuity;
use App\Services\WebFormChatRouting;
use App\Services\WebFormReceipt;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 18)->setTime(12, 0));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('c', 32)));
    config()->set('edna.subject_id', '2423');
    DB::table('edna_intake_cutovers')->insert(['name' => WebChatContinuity::NAME,
        'entry_id_after' => 0, 'starts_at' => now()->subMinute()]);
    $this->routing = Mockery::mock(WebFormChatRouting::class);
    $this->routing->shouldReceive('schedule')->andReturn(true)->byDefault();
    app()->instance(WebFormChatRouting::class, $this->routing);
    Http::preventStrayRequests();
    Queue::fake();
});

function continuityReceipt(string $token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', $created = null): object
{
    $created ??= now()->subSeconds(10);
    $id = (string) Str::uuid();
    DB::table('web_form_receipts')->insert(['id' => $id, 'reference_hash' => hash('sha256', $token),
        'phone_hash' => (new AttributionJourney)->phoneHash('5493510000000'), 'state' => 'synced',
        'lead_id' => '428617', 'contact_id' => '205259', 'received_at' => $created,
        'expires_at' => now()->addDay(), 'created_at' => $created, 'updated_at' => $created]);

    return DB::table('web_form_receipts')->find($id);
}

function continuityEvent(string $text = 'Otro mensaje', string $type = 'TEXT', array $overrides = []): array
{
    $payload = array_replace_recursive(['id' => (string) random_int(1000000000, 2000000000), 'subjectId' => '2423',
        'subscriber' => ['identifier' => '5493510000000'], 'receivedAt' => now()->toIso8601String(),
        'messageContent' => ['type' => $type, 'text' => $text]], $overrides);
    $id = DB::table('edna_incoming_events')->insertGetId(['subject_id' => $payload['subjectId'],
        'message_id' => $payload['id'], 'payload' => Crypt::encryptString(json_encode($payload)),
        'status' => 'delivered', 'created_at' => now(), 'updated_at' => now()]);

    return [DB::table('edna_incoming_events')->find($id), $payload];
}

function continuityProof(object $event, string $session = '318129', string $chat = '121095'): array
{
    return ['version' => 1, 'verified' => true, 'source' => 'bitrix_openline_session', 'evidence' => 'external_message_id',
        'entry_event_id' => (int) $event->id, 'entry_message_id' => $event->message_id,
        'chat_id' => $chat, 'session_id' => $session, 'message_id' => '7084957', 'activity_id' => '713879',
        'native_lead_id' => '428617'];
}

function continuityContext(): array
{
    $receipt = continuityReceipt();
    [$anchor, $payload] = continuityEvent('Ya completé el formulario (solicitud: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)');
    $id = (new WebChatContinuity)->captureReference($anchor, $receipt);

    return [$id, $anchor, $payload, $receipt];
}

test('a valid new reference stores only a transport context and a fixed eight hour anchor', function () {
    [$id, $anchor, , $receipt] = continuityContext();
    $context = DB::table('web_chat_contexts')->find($id);
    $continuation = DB::table('web_form_continuations')->where('entry_event_id', $anchor->id)->first();

    expect($id)->toBeInt()->and($context->anchor_entry_event_id)->toBe($anchor->id)
        ->and($context->submission_id)->toBe($receipt->id)->and($context->chat_id)->toBeNull()
        ->and($context->session_id)->toBeNull()->and($context->proof)->toBeNull()
        ->and($context->expires_at)->toBe(now()->addHours(8)->toDateTimeString())
        ->and($continuation)->toMatchObject(['context_id' => $id, 'proof_source' => 'web_context', 'state' => 'ready'])
        ->and($continuation->lead_id)->toBeNull();
    Http::assertNothingSent();
    Queue::assertNothingPushed();
});

test('a later message inherits waiting context without using the phone as CRM identity', function () {
    [$id, , , $receipt] = continuityContext();
    [$event, $payload] = continuityEvent();
    $this->routing->shouldReceive('schedule')->once()->with((int) $event->id, $receipt->id)->andReturn(true);

    $decision = (new WebChatContinuity)->receive($event, $payload);

    expect($decision)->toMatchArray(['context_id' => $id, 'submission_id' => $receipt->id,
        'proof_source' => 'web_context', 'state' => 'ready', 'lead_id' => null]);
    expect((new WebChatContinuity)->blocksOutbound($event))->toBeTrue();
    Http::assertNothingSent();
    Queue::assertNothingPushed();
});

test('a pending web receipt keeps the inherited message waiting', function () {
    [$id, , , $receipt] = continuityContext();
    DB::table('web_form_receipts')->where('id', $receipt->id)->update(['state' => 'pending']);
    [$event, $payload] = continuityEvent();

    expect((new WebChatContinuity)->receive($event, $payload))->toMatchArray(['context_id' => $id, 'state' => 'waiting']);
});

test('a repeated reference never renews the context anchor or expiry', function () {
    [$id, $anchor, , $receipt] = continuityContext();
    $expiry = DB::table('web_chat_contexts')->find($id)->expires_at;
    $this->travel(7)->hours();
    [$next] = continuityEvent('(solicitud: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)');

    expect((new WebChatContinuity)->captureReference($next, $receipt))->toBe($id)
        ->and(DB::table('web_chat_contexts')->count())->toBe(1)
        ->and(DB::table('web_chat_contexts')->find($id))->toMatchObject([
            'anchor_entry_event_id' => $anchor->id, 'expires_at' => $expiry]);
});

test('a new explicit reference or FLOW is never inherited as another application', function (string $kind) {
    continuityContext();
    [$event, $payload] = continuityEvent($kind === 'reference' ? '(solicitud: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)' : 'Respuesta',
        $kind === 'flow' ? 'FLOW' : 'TEXT');

    expect((new WebChatContinuity)->receive($event, $payload))->toBeNull();
    if ($kind === 'flow') {
        expect((new WebChatContinuity)->blocksOutbound($event))->toBeFalse();
    }
    expect(DB::table('web_form_continuations')->where('entry_event_id', $event->id)->exists())->toBeFalse();
})->with(['reference', 'flow']);

test('two active submissions on one transport require review and do not schedule routing', function () {
    continuityContext();
    $receipt = continuityReceipt(str_repeat('b', 32));
    [$second] = continuityEvent('(solicitud: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)');
    $id = (new WebChatContinuity)->captureReference($second, $receipt);
    expect(DB::table('web_form_continuations')->where('entry_event_id', $second->id)->first())
        ->toMatchObject(['context_id' => $id, 'state' => 'review', 'reason' => 'web_context_multiple_submissions']);
    [$event, $payload] = continuityEvent();

    expect((new WebChatContinuity)->receive($event, $payload))->toMatchArray([
        'state' => 'review', 'reason' => 'web_context_multiple_submissions', 'submission_id' => null, 'context_id' => null])
        ->and((new WebChatContinuity)->blocksOutbound($event))->toBeTrue();
    $this->routing->shouldNotHaveReceived('schedule');
    Http::assertNothingSent();
});

test('the exact anchor proof binds the native chat and session once', function () {
    [$id, $anchor] = continuityContext();
    $proof = continuityProof($anchor);
    $result = (new WebChatContinuity)->bind((int) $anchor->id, $proof);

    expect($result)->toMatchArray(['status' => 'bound', 'context_id' => $id, 'proof' => $proof])
        ->and(DB::table('web_chat_contexts')->find($id))->toMatchObject(['chat_id' => 121095, 'session_id' => 318129, 'state' => 'bound'])
        ->and(json_decode(DB::table('web_chat_contexts')->find($id)->proof, true))->toEqual($proof);
    Http::assertNothingSent();
});

test('a subsequent proof must belong to the same chat and session and cannot replace the anchor', function () {
    [$id, $anchor] = continuityContext();
    $service = new WebChatContinuity;
    $service->bind((int) $anchor->id, $original = continuityProof($anchor));
    [$event, $payload] = continuityEvent();
    $service->receive($event, $payload);
    $proof = continuityProof($event);
    $proof['message_id'] = '7084999';

    expect($service->bind((int) $event->id, $proof))->toMatchArray(['status' => 'bound', 'proof' => $proof])
        ->and(json_decode(DB::table('web_chat_contexts')->find($id)->proof, true))->toEqual($original);
});

test('an unbound later callback resolves and proves the original anchor in its current chat', function () {
    [$id, $anchor] = continuityContext();
    [$event, $payload] = continuityEvent();
    (new WebChatContinuity)->receive($event, $payload);
    $binding = Mockery::mock(EdnaMessageBinding::class);
    $binding->shouldReceive('resolve')->once()->withArgs(fn ($e, $p, $chat) => $e->id === $anchor->id
        && $p['id'] === $anchor->message_id && $chat === 121095)->andReturn(continuityProof($anchor));
    app()->instance(EdnaMessageBinding::class, $binding);

    expect((new WebChatContinuity)->bind((int) $event->id, continuityProof($event)))
        ->toMatchArray(['status' => 'bound', 'context_id' => $id]);
});

test('an unproven anchor cannot settle identity from the shared phone', function () {
    [$id] = continuityContext();
    [$event, $payload] = continuityEvent();
    (new WebChatContinuity)->receive($event, $payload);
    $binding = Mockery::mock(EdnaMessageBinding::class);
    $binding->shouldReceive('resolve')->once()->andReturnNull();
    app()->instance(EdnaMessageBinding::class, $binding);

    expect((new WebChatContinuity)->bind((int) $event->id, continuityProof($event)))
        ->toMatchArray(['status' => 'review', 'reason' => 'web_context_anchor_unverified'])
        ->and(DB::table('web_chat_contexts')->find($id)->proof)->toBeNull();
    Http::assertNothingSent();
});

test('a different chat sharing the transport cannot inherit CRM continuity', function () {
    [$id, $anchor] = continuityContext();
    $service = new WebChatContinuity;
    $service->bind((int) $anchor->id, continuityProof($anchor));
    [$event, $payload] = continuityEvent();
    $service->receive($event, $payload);

    expect($service->bind((int) $event->id, continuityProof($event, '318129', '99999')))
        ->toMatchArray(['status' => 'review', 'reason' => 'web_context_chat_mismatch'])
        ->and(DB::table('web_chat_contexts')->find($id)->state)->toBe('bound');
});

test('a new session releases the old context and reroutes only that fresh callback in its transaction', function () {
    [$id, $anchor] = continuityContext();
    $service = new WebChatContinuity;
    $service->bind((int) $anchor->id, continuityProof($anchor));
    [$event, $payload] = continuityEvent();
    $service->receive($event, $payload);
    $intake = Mockery::mock(EdnaIntake::class);
    $intake->shouldReceive('receiveEntry')->once()->withArgs(function ($e, $p) use ($event, $payload, $service) {
        expect(DB::transactionLevel())->toBeGreaterThan(0)
            ->and(DB::table('web_form_continuations')->where('entry_event_id', $event->id)->first()->state)->toBe('released')
            ->and($service->receive($event, $payload))->toBeNull();

        return $e->id === $event->id && $p === $payload;
    })->andReturn(true);
    app()->instance(EdnaIntake::class, $intake);

    expect($service->bind((int) $event->id, continuityProof($event, '318999')))
        ->toMatchArray(['status' => 'released', 'rerouted' => true])
        ->and(DB::table('web_chat_contexts')->find($id)->state)->toBe('released');
    expect($service->bind((int) $event->id, continuityProof($event, '318999'))['status'])->toBe('released');
    Queue::assertNothingPushed();
});

test('outbound questions with a bound context require the exact fresh chat and session proof', function () {
    [, $anchor] = continuityContext();
    $service = new WebChatContinuity;
    $service->bind((int) $anchor->id, continuityProof($anchor));
    [$event] = continuityEvent();

    expect($service->blocksOutbound($event))->toBeFalse()
        ->and($service->blocksOutbound($event, continuityProof($event)))->toBeTrue()
        ->and($service->blocksOutbound($event, continuityProof($event, '318999')))->toBeFalse()
        ->and($service->blocksOutbound($event, continuityProof($event, '318129', '99999')))->toBeFalse();
});

test('a new web context can stop a question queued before its anchor without reprocessing that callback', function () {
    [$earlier] = continuityEvent();
    [$id, $anchor] = continuityContext();

    expect($anchor->id)->toBeGreaterThan($earlier->id)
        ->and((new WebChatContinuity)->blocksOutbound($earlier))->toBeTrue()
        ->and(DB::table('web_form_continuations')->where('entry_event_id', $earlier->id)->exists())->toBeFalse()
        ->and(DB::table('web_chat_contexts')->find($id)->chat_id)->toBeNull();
    Http::assertNothingSent();
    Queue::assertNothingPushed();
});

test('human preservation stops the current session but does not stop releasing a different session', function () {
    [$id, $anchor] = continuityContext();
    $service = new WebChatContinuity;
    $service->bind((int) $anchor->id, continuityProof($anchor));
    $service->sync((int) $anchor->id, 'preserved', 'operator_attention_preserved', ['transfer_state' => 'preserved']);
    expect($service->bind((int) $anchor->id, continuityProof($anchor))['status'])->toBe('preserved')
        ->and($service->blocksOutbound($anchor, continuityProof($anchor)))->toBeTrue();
    [$event, $payload] = continuityEvent();
    $service->receive($event, $payload);
    $intake = Mockery::mock(EdnaIntake::class);
    $intake->shouldReceive('receiveEntry')->once()->andReturn(true);
    app()->instance(EdnaIntake::class, $intake);
    expect($service->bind((int) $event->id, continuityProof($event, '318999'))['status'])->toBe('released')
        ->and(DB::table('web_chat_contexts')->find($id)->state)->toBe('released');
});

test('observing an assigned seller never creates a transfer acknowledgement or resolution', function () {
    [$id, $anchor] = continuityContext();
    $service = new WebChatContinuity;
    $service->bind((int) $anchor->id, continuityProof($anchor));
    $service->sync((int) $anchor->id, 'routed', 'already_with_assigned_seller', [
        'link_state' => 'linked', 'transfer_state' => 'not_needed', 'seller_id' => '71159']);
    $context = DB::table('web_chat_contexts')->find($id);
    expect($context->state)->toBe('observed')->and($context->observed_at)->not->toBeNull()
        ->and((bool) $context->transfer_acknowledged)->toBeFalse()->and($context->resolved_at)->toBeNull()
        ->and($context->confirmed_transfer_entry_event_id)->toBeNull();
});

test('a confirmed transfer receipt is kept separate and survives later owner observations', function () {
    [$id, $anchor] = continuityContext();
    $service = new WebChatContinuity;
    $service->bind((int) $anchor->id, continuityProof($anchor));
    $intent = ['session_id' => '318129', 'seller_id' => '71159', 'owner_before' => '74827', 'created_at' => now()->toIso8601String()];
    $service->sync((int) $anchor->id, 'routed', 'assigned_seller_confirmed', [
        'transfer_state' => 'confirmed', 'transfer_acknowledged' => true, 'transfer_intent' => $intent]);
    [$event, $payload] = continuityEvent();
    $service->receive($event, $payload);
    $service->sync((int) $event->id, 'routed', 'already_with_assigned_seller', ['transfer_state' => 'not_needed']);
    $context = DB::table('web_chat_contexts')->find($id);
    expect($context->state)->toBe('resolved')->and((bool) $context->transfer_acknowledged)->toBeTrue()
        ->and($context->resolved_at)->not->toBeNull()->and($context->confirmed_transfer_entry_event_id)->toBe($anchor->id)
        ->and(json_decode($context->transfer_intent, true))->toEqual($intent)
        ->and($context->last_route_entry_event_id)->toBe($event->id);
});

test('an expired context cannot be renewed by more messages or the original reference', function () {
    [$id, , , $receipt] = continuityContext();
    $this->travel(8)->hours();
    [$event, $payload] = continuityEvent();
    [$reference] = continuityEvent('(solicitud: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)');
    $service = new WebChatContinuity;

    expect($service->receive($event, $payload))->toBeNull()->and($service->blocksOutbound($event))->toBeFalse()
        ->and($service->captureReference($reference, $receipt))->toBeNull()
        ->and(DB::table('web_chat_contexts')->count())->toBe(1)
        ->and(DB::table('web_chat_contexts')->find($id)->last_entry_event_id)->not->toBe($event->id);
});

test('old receipts callbacks and payload mismatches stay outside the new contract', function (string $kind) {
    $receipt = continuityReceipt('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', $kind === 'receipt' ? now()->subHours(2) : null);
    [$event, $payload] = continuityEvent('(solicitud: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)', 'TEXT',
        $kind === 'received' ? ['receivedAt' => now()->subHours(2)->toIso8601String()] : []);
    if ($kind === 'id') {
        DB::table('edna_intake_cutovers')->update(['entry_id_after' => $event->id]);
    } elseif ($kind === 'subject') {
        config()->set('edna.subject_id', '9999');
    } elseif ($kind === 'inactive') {
        DB::table('edna_intake_cutovers')->delete();
    }

    expect((new WebChatContinuity)->captureReference($event, $receipt))->toBeNull()
        ->and(DB::table('web_chat_contexts')->count())->toBe(0);
})->with(['receipt', 'received', 'id', 'subject', 'inactive']);

test('a supplied payload cannot replace the authenticated callback payload', function () {
    continuityContext();
    [$event, $payload] = continuityEvent();
    $payload['subscriber']['identifier'] = '5493511111111';
    expect((new WebChatContinuity)->receive($event, $payload))->toBeNull();
});

test('activation keeps both immutable boundaries and never processes older callbacks', function () {
    DB::table('edna_intake_cutovers')->where('name', WebChatContinuity::NAME)->delete();
    [$old] = continuityEvent();
    $this->artisan('edna:web-chat-continuity activate')->assertSuccessful();
    $cut = DB::table('edna_intake_cutovers')->where('name', WebChatContinuity::NAME)->first();
    expect($cut->entry_id_after)->toBe($old->id)->and((new WebChatContinuity)->eligibleEntry($old))->toBeFalse();
    $this->travel(2)->seconds();
    [$fresh] = continuityEvent();
    [$late] = continuityEvent('Viejo', 'TEXT', ['receivedAt' => now()->subMinute()->toIso8601String()]);
    expect((new WebChatContinuity)->eligibleEntry($fresh))->toBeTrue()
        ->and((new WebChatContinuity)->eligibleEntry($late))->toBeFalse();
    $this->artisan('edna:web-chat-continuity activate')->assertSuccessful();
    expect((array) DB::table('edna_intake_cutovers')->where('name', WebChatContinuity::NAME)->first())->toEqual((array) $cut)
        ->and(DB::table('web_chat_contexts')->count())->toBe(0);
    $this->artisan('edna:web-chat-continuity status')->assertSuccessful();
    Queue::assertNothingPushed();
});

test('a bound context still validates its original receipt and anchor window', function (string $change) {
    [$id, $anchor, , $receipt] = continuityContext();
    $service = new WebChatContinuity;
    $service->bind((int) $anchor->id, continuityProof($anchor));
    if ($change === 'receipt') {
        DB::table('web_form_receipts')->where('id', $receipt->id)->update(['received_at' => now()->addMinute()]);
    } else {
        DB::table('web_chat_contexts')->where('id', $id)->update(['expires_at' => now()->addHours(9)]);
    }
    expect($service->bind((int) $anchor->id, continuityProof($anchor)))
        ->toMatchArray(['status' => 'review', 'reason' => 'web_context_anchor_unverified']);
})->with(['receipt', 'expiry']);

test('transfer resolution requires a bound session and a complete dated intention', function (string $change) {
    [$id, $anchor] = continuityContext();
    $service = new WebChatContinuity;
    if ($change !== 'unbound') {
        $service->bind((int) $anchor->id, continuityProof($anchor));
    }
    $intent = ['session_id' => '318129', 'seller_id' => '71159', 'owner_before' => '74827', 'created_at' => now()->toIso8601String()];
    if ($change === 'owner') {
        unset($intent['owner_before']);
    } elseif ($change === 'date') {
        $intent['created_at'] = 'invalid';
    } elseif ($change === 'session') {
        $intent['session_id'] = '318999';
    }
    $service->sync((int) $anchor->id, 'routed', 'receipt_under_test', [
        'transfer_state' => 'confirmed', 'transfer_acknowledged' => true, 'transfer_intent' => $intent]);
    $context = DB::table('web_chat_contexts')->find($id);
    expect((bool) $context->transfer_acknowledged)->toBeFalse()->and($context->resolved_at)->toBeNull()
        ->and($context->confirmed_transfer_entry_event_id)->toBeNull();
})->with(['unbound', 'owner', 'date', 'session']);

test('capture reads a concurrent synced result inside the receipt lock instead of restoring waiting', function () {
    $receipt = continuityReceipt();
    DB::table('web_form_receipts')->where('id', $receipt->id)->update(['state' => 'pending', 'lead_id' => null]);
    $receipt = DB::table('web_form_receipts')->find($receipt->id);
    [$anchor] = continuityEvent('(solicitud: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)');
    $profiles = Mockery::mock(EdnaOrganicProfile::class);
    $profiles->shouldReceive('websiteAnswer')->andReturnNull();
    app()->instance(EdnaOrganicProfile::class, $profiles);
    $serializer = Mockery::mock(WebFormReceipt::class)->makePartial();
    $serializer->shouldReceive('serialized')->once()->andReturnUsing(function ($hash, $callback) use ($receipt) {
        // The web ACK commits after capture starts, before its serialized section.
        (new WebFormReceipt)->result(['_journey_links' => ['submission_id' => $receipt->id]],
            ['ok' => true, 'lead_id' => '428617', 'contact_id' => '205259'], true);

        return (new WebFormReceipt)->serialized($hash, $callback);
    });
    app()->instance(WebFormReceipt::class, $serializer);

    $id = (new WebChatContinuity)->captureReference($anchor, $receipt);
    expect($id)->toBeInt()
        ->and(DB::table('web_form_continuations')->where('entry_event_id', $anchor->id)->first()->state)->toBe('ready')
        ->and(DB::table('web_form_receipts')->find($receipt->id)->state)->toBe('synced');
});

test('a web ACK after waiting continuations exist promotes and schedules both anchor and inherited message', function () {
    $receipt = continuityReceipt();
    DB::table('web_form_receipts')->where('id', $receipt->id)->update(['state' => 'pending', 'lead_id' => null]);
    $receipt = DB::table('web_form_receipts')->find($receipt->id);
    [$anchor] = continuityEvent('(solicitud: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)');
    $id = (new WebChatContinuity)->captureReference($anchor, $receipt);
    [$next, $payload] = continuityEvent();
    (new WebChatContinuity)->receive($next, $payload);
    expect(DB::table('web_form_continuations')->where('context_id', $id)->pluck('state')->all())
        ->toBe(['waiting', 'waiting']);
    $profiles = Mockery::mock(EdnaOrganicProfile::class);
    $profiles->shouldReceive('websiteAnswer')->andReturnNull();
    app()->instance(EdnaOrganicProfile::class, $profiles);
    $this->routing->shouldReceive('schedule')->once()->with((int) $anchor->id, $receipt->id)->andReturn(true);
    $this->routing->shouldReceive('schedule')->once()->with((int) $next->id, $receipt->id)->andReturn(true);

    (new WebFormReceipt)->result(['_journey_links' => ['submission_id' => $receipt->id]],
        ['ok' => true, 'lead_id' => '428617', 'contact_id' => '205259'], true);
    expect(DB::table('web_form_continuations')->where('context_id', $id)->pluck('state')->all())
        ->toBe(['ready', 'ready']);
});

test('a newer explicitly referenced receipt releases only an untouched older request for the same person and session', function (string $scenario) {
    $continuity = new WebChatContinuity;
    [$oldId, $anchor, , $old] = continuityContext();
    $identity = str_repeat('a', 64);
    DB::table('web_form_receipts')->where('id', $old->id)->update(['identity_hash' => $identity]);
    $oldProof = continuityProof($anchor);
    $continuity->bind($anchor->id, $oldProof);
    if ($scenario === 'human') {
        DB::table('web_chat_contexts')->where('id', $oldId)->update(['state' => 'preserved', 'reason' => 'manual_transfer_preserved']);
    }
    $this->travel(1)->minutes();
    $receipt = continuityReceipt(str_repeat('b', 32));
    DB::table('web_form_receipts')->where('id', $receipt->id)->update([
        'identity_hash' => $scenario === 'other_person' ? str_repeat('b', 64) : $identity, 'lead_id' => '428619',
    ]);
    [$second, $payload] = continuityEvent('(solicitud: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)');
    $newId = $continuity->captureReference($second, $receipt);
    $candidate = DB::table('web_form_continuations')->where('entry_event_id', $second->id)->first();
    if (in_array($scenario, ['human', 'other_person'], true)) {
        expect($candidate->state)->toBe('review')
            ->and(DB::table('web_chat_contexts')->find($oldId)->state)->toBe($scenario === 'human' ? 'preserved' : 'review');

        return;
    }
    expect($candidate->reason)->toBe('explicit_replacement_pending')
        ->and(DB::table('web_chat_contexts')->find($oldId)->state)->toBe('bound');
    $proof = continuityProof($second, $scenario === 'different_session' ? '318131' : '318129');
    $proof['message_id'] = $scenario === 'older_message' ? '7084956' : '7084959';
    $result = $continuity->bind($second->id, $proof);
    if ($scenario !== 'latest') {
        expect($result['status'])->toBe('review')->and(DB::table('web_chat_contexts')->find($oldId)->state)->toBe('review');

        return;
    }
    expect($result['status'])->toBe('bound')
        ->and(DB::table('web_chat_contexts')->find($oldId))->toMatchObject([
            'state' => 'released', 'reason' => 'newer_explicit_reference_same_session'])
        ->and(DB::table('web_chat_contexts')->find($newId)->submission_id)->toBe($receipt->id)
        ->and($continuity->bind($anchor->id, $oldProof)['status'])->toBe('released');
    [$again] = continuityEvent('(solicitud: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)');
    expect($continuity->captureReference($again, $old))->toBe($oldId)
        ->and(DB::table('web_form_continuations')->where('entry_event_id', $again->id)->value('reason'))->toBe('web_reference_superseded');
})->with(['latest', 'different_session', 'older_message', 'other_person', 'human']);
