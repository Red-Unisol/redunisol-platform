<?php

use App\Services\EdnaOrganicTransport;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

uses(TestCase::class);

beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-11T15:00:00Z'));
    config()->set('app.key', 'base64:'.base64_encode(str_repeat('o', 32)));
    config()->set('edna.api_key', 'fake-organic-key');
    Http::preventStrayRequests();
});

function organicTransportMenu(array $overrides = []): object
{
    return (object) array_replace(['request_id' => '1c1e0e6a-0f75-4dd5-a0c8-fac30ac3046f',
        'subject_id' => '2423', 'cascade_id' => '2557', 'recipient' => Crypt::encryptString('5493510000000'),
        'send_state' => 'sending', 'send_started_at' => '2026-11-11T14:00:00Z', 'outgoing_message_id' => null], $overrides);
}

function organicTransportHistory(object $menu, array $overrides = []): array
{
    return array_replace(['messageId' => 700001, 'comment' => $menu->request_id, 'direction' => 'OUT',
        'channelType' => 'WHATSAPP', 'subjectId' => 2423, 'cascadeId' => 2557, 'address' => '5493510000000',
        'deliveryStatus' => 'DELIVERED', 'content' => ['type' => 'TEXT', 'text' => EdnaOrganicTransport::TEXT]], $overrides);
}

test('organic content preserves the exact requested copy and two bounded response buttons', function () {
    $menu = organicTransportMenu();
    $content = (new EdnaOrganicTransport)->content($menu);
    expect($content)->toBe(['contentType' => 'TEXT',
        'text' => "¡Hola! 👋 Te comunicaste con el sector comercial de Red Unisol.\nPara ayudarte más rápido, contanos: ¿tu consulta es por un préstamo o por otro tema?",
        'keyboard' => ['rows' => [['buttons' => [
            ['text' => 'Quiero un préstamo', 'type' => 'QUICK_REPLY', 'payload' => 'organic:'.$menu->request_id.':loan'],
            ['text' => 'Otra consulta', 'type' => 'QUICK_REPLY', 'payload' => 'organic:'.$menu->request_id.':other'],
        ]]]]]);
    expect((new EdnaOrganicTransport)->content($menu->request_id))->toBe($content);
    foreach ($content['keyboard']['rows'][0]['buttons'] as $button) {
        expect(mb_strlen($button['text']))->toBeLessThanOrEqual(20)
            ->and(strlen($button['payload']))->toBeLessThanOrEqual(128);
    }
    Http::assertNothingSent();
});

test('only an exact opaque organic button token becomes a choice', function (string $choice) {
    $request = organicTransportMenu()->request_id;
    expect(EdnaOrganicTransport::parseChoice(EdnaOrganicTransport::payload($request, $choice)))
        ->toBe(['request_id' => $request, 'choice' => $choice]);
})->with(['loan', 'other']);

test('visible text and malformed or extended tokens never become an organic choice', function (mixed $payload) {
    expect(EdnaOrganicTransport::parseChoice($payload))->toBeNull();
})->with([null, 1, true, [[]], 'Quiero un préstamo', 'Otra consulta', 'loan',
    'organic:1c1e0e6a-0f75-4dd5-a0c8-fac30ac3046f:other:loan',
    'organic:1c1e0e6a-0f75-4dd5-a0c8-fac30ac3046f:LOAN',
    'organic:1c1e0e6a-0f75-4dd5-a0c8-fac30ac3046x:loan',
    ' organic:1c1e0e6a-0f75-4dd5-a0c8-fac30ac3046f:loan',
    "organic:1c1e0e6a-0f75-4dd5-a0c8-fac30ac3046f:loan\n"]);

test('invalid outbound button identities fail without a provider request', function (string $request, string $choice) {
    expect(fn () => EdnaOrganicTransport::payload($request, $choice))->toThrow(InvalidArgumentException::class);
    Http::assertNothingSent();
})->with([['not-a-uuid', 'loan'], ['1c1e0e6a-0f75-4dd5-a0c8-fac30ac3046f', 'visible-text']]);

test('channel verification is separate from sending and checks the configured cascade', function () {
    Http::fake(['app.edna.io/api/cascade/get-all' => Http::response([
        ['id' => 2557, 'status' => 'ACTIVE', 'stages' => [['subject' => ['id' => 2423, 'locked' => false]]]],
    ])]);
    (new EdnaOrganicTransport)->assertChannel(organicTransportMenu(['send_state' => 'pending']));
    Http::assertSentCount(1);
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'cascade/schedule'));
});

test('channel errors are sanitized without retaining the original exception', function () {
    $attempts = 0;
    Http::fake(function () use (&$attempts) {
        $attempts++;
        throw new ConnectionException('secret-url-and-phone');
    });
    try {
        (new EdnaOrganicTransport)->assertChannel(organicTransportMenu());
        $this->fail('A missing channel must fail.');
    } catch (RuntimeException $exception) {
        expect($exception->getMessage())->toBe('Organic menu channel could not be verified.')
            ->and($exception->getPrevious())->toBeNull();
    }
    expect($attempts)->toBe(1);
});

test('schedule requires the caller claim and a valid encrypted transport context', function (string $field, mixed $value) {
    expect(fn () => (new EdnaOrganicTransport)->schedule(organicTransportMenu([$field => $value])))
        ->toThrow(RuntimeException::class);
    Http::assertNothingSent();
})->with([['send_state', 'pending'], ['send_state', 'accepted'], ['request_id', 'invalid'],
    ['recipient', '5493510000000'], ['subject_id', ''], ['cascade_id', '0'], ['send_started_at', null]]);

test('a claimed schedule makes one POST with the exact menu and an acknowledged request', function () {
    $menu = organicTransportMenu();
    Http::fake(['app.edna.io/api/cascade/schedule' => Http::response(['requestId' => $menu->request_id])]);
    $result = (new EdnaOrganicTransport)->schedule($menu);
    expect($result['send_state'])->toBe('accepted')->and($result['send_reason'])->toBeNull()
        ->and($result['accepted_at']->equalTo(now()))->toBeTrue();
    Http::assertSent(fn ($r) => $r->method() === 'POST' && $r['requestId'] === $menu->request_id
        && $r['comment'] === $menu->request_id && $r['cascadeId'] === '2557'
        && $r['subscriberFilter'] === ['address' => '5493510000000', 'type' => 'PHONE']
        && $r['content']['whatsappContent'] === (new EdnaOrganicTransport)->content($menu));
    Http::assertSentCount(1);
});

test('ambiguous schedule acknowledgements remain unknown and are never retried by transport', function (int $status, array $body, string $state) {
    Http::fake(['app.edna.io/api/cascade/schedule' => Http::response($body, $status)]);
    $result = (new EdnaOrganicTransport)->schedule(organicTransportMenu());
    expect($result['send_state'])->toBe($state)->and($result)->not->toHaveKey('accepted_at');
    Http::assertSentCount(1);
})->with([[200, ['requestId' => 'wrong'], 'unknown'], [202, [], 'unknown'], [500, [], 'unknown'],
    [408, [], 'unknown'], [429, [], 'unknown'], [400, [], 'rejected'], [401, [], 'rejected']]);

test('a lost schedule response returns no secrets and triggers no automatic retry or history POST', function () {
    $attempts = 0;
    Http::fake(function () use (&$attempts) {
        $attempts++;
        throw new ConnectionException('private-url-credential-and-phone');
    });
    $result = (new EdnaOrganicTransport)->schedule(organicTransportMenu());
    expect($result)->toBe(['send_state' => 'unknown', 'send_reason' => 'schedule_acknowledgement_uncertain']);
    expect($attempts)->toBe(1);
});

test('history confirms the exact outgoing menu even if the provider omits its keyboard', function (bool $json) {
    $menu = organicTransportMenu(['send_state' => 'accepted']);
    $message = organicTransportHistory($menu);
    if ($json) {
        $message['content'] = json_encode($message['content']);
    }
    Http::fake(['app.edna.io/api/messages/history' => Http::response(['content' => [$message], 'hasNext' => false])]);
    $result = (new EdnaOrganicTransport)->reconcile($menu);
    expect($result['send_state'])->toBe('confirmed')->and($result['outgoing_message_id'])->toBe('700001')
        ->and($result['confirmed_at']->equalTo(now()))->toBeTrue();
    Http::assertSent(fn ($r) => str_ends_with($r->url(), '/messages/history') && $r['limit'] === 1000
        && $r['offset'] === 0 && $r['dateFrom'] === '2026-11-11T13:59:00+00:00'
        && $r['dateTo'] === '2026-11-11T15:00:00+00:00' && $r['direction'] === 'OUT');
    Http::assertSentCount(1);
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'cascade/schedule'));
})->with([true, false]);

test('history never searches beyond twenty four hours after the durable send start', function () {
    $menu = organicTransportMenu(['send_started_at' => '2026-11-09T14:00:00Z']);
    Http::fake(['app.edna.io/api/messages/history' => Http::response(['content' => [], 'hasNext' => false])]);
    expect((new EdnaOrganicTransport)->reconcile($menu)['send_state'])->toBe('unknown');
    Http::assertSent(fn ($r) => $r['dateTo'] === '2026-11-10T14:00:00+00:00');
});

test('an exact supplied keyboard is checked without depending on JSON object key order', function () {
    $menu = organicTransportMenu();
    $keyboard = (new EdnaOrganicTransport)->content($menu)['keyboard'];
    $keyboard['rows'][0]['buttons'][0] = array_reverse($keyboard['rows'][0]['buttons'][0], true);
    $message = organicTransportHistory($menu);
    $message['content']['keyboard'] = $keyboard;
    Http::fake(['app.edna.io/api/messages/history' => Http::response(['content' => [$message], 'hasNext' => false])]);
    expect((new EdnaOrganicTransport)->reconcile($menu)['send_state'])->toBe('confirmed');
});

test('a mismatched outgoing history cannot confirm another message', function (string $field, mixed $value) {
    $menu = organicTransportMenu();
    $message = organicTransportHistory($menu, [$field => $value]);
    Http::fake(['app.edna.io/api/messages/history' => Http::response(['content' => [$message], 'hasNext' => false])]);
    $result = (new EdnaOrganicTransport)->reconcile($menu);
    expect($result['send_state'])->toBe('unknown')->and($result)->not->toHaveKey('confirmed_at');
    Http::assertSentCount(1);
})->with([['comment', 'wrong-request'], ['direction', 'IN'], ['channelType', 'SMS'], ['subjectId', 999],
    ['cascadeId', 999], ['address', '5493519999999'], ['messageId', true], ['messageId', '0'],
    ['content', ['type' => 'FLOW', 'text' => EdnaOrganicTransport::TEXT]],
    ['content', ['type' => 'TEXT', 'text' => str_replace("\n", ' ', EdnaOrganicTransport::TEXT)]],
    ['content', ['type' => 'TEXT', 'text' => EdnaOrganicTransport::TEXT, 'keyboard' => null]],
    ['content', 'not-json'], ['deliveryStatus', 'PENDING']]);

test('changed button labels types tokens or order cannot confirm the outgoing menu', function (string $change) {
    $menu = organicTransportMenu();
    $keyboard = (new EdnaOrganicTransport)->content($menu)['keyboard'];
    if ($change === 'order') {
        $keyboard['rows'][0]['buttons'] = array_reverse($keyboard['rows'][0]['buttons']);
    } else {
        $keyboard['rows'][0]['buttons'][0][$change] = 'tampered';
    }
    $message = organicTransportHistory($menu);
    $message['content']['keyboard'] = $keyboard;
    Http::fake(['app.edna.io/api/messages/history' => Http::response(['content' => [$message], 'hasNext' => false])]);
    expect((new EdnaOrganicTransport)->reconcile($menu)['send_state'])->toBe('unknown');
})->with(['text', 'type', 'payload', 'order']);

test('history completeness ambiguity and a recorded outgoing ID remain mandatory', function (string $condition) {
    $menu = organicTransportMenu();
    $message = organicTransportHistory($menu);
    $body = ['content' => [$message], 'hasNext' => false];
    if ($condition === 'truncated') {
        $body['hasNext'] = true;
    } elseif ($condition === 'missing-completeness') {
        unset($body['hasNext']);
    } elseif ($condition === 'multiple') {
        $body['content'][] = array_replace($message, ['messageId' => 700002]);
    } elseif ($condition === 'conflicting-duplicate') {
        $body['content'][] = array_replace($message, ['deliveryStatus' => 'READ']);
    } else {
        $menu->outgoing_message_id = '700002';
    }
    Http::fake(['app.edna.io/api/messages/history' => Http::response($body)]);
    expect((new EdnaOrganicTransport)->reconcile($menu)['send_state'])->toBe('unknown');
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'cascade/schedule'));
})->with(['truncated', 'missing-completeness', 'multiple', 'conflicting-duplicate', 'recorded-id']);

test('provider rejection can omit a body but still requires an exact send identity', function () {
    $menu = organicTransportMenu();
    $message = organicTransportHistory($menu, ['deliveryStatus' => 'FAILED', 'content' => null]);
    Http::fake(['app.edna.io/api/messages/history' => Http::response(['content' => [$message], 'hasNext' => false])]);
    expect((new EdnaOrganicTransport)->reconcile($menu))->toBe([
        'send_state' => 'rejected', 'send_reason' => 'outgoing_not_delivered', 'outgoing_message_id' => '700001',
    ]);
});

test('history connection errors retain only a safe unknown result and never schedule a resend', function () {
    $attempts = 0;
    Http::fake(function () use (&$attempts) {
        $attempts++;
        throw new ConnectionException('private-url-credential-and-phone');
    });
    expect((new EdnaOrganicTransport)->reconcile(organicTransportMenu(['outgoing_message_id' => '700001'])))
        ->toBe(['send_state' => 'unknown', 'send_reason' => 'outgoing_history_unconfirmed', 'outgoing_message_id' => '700001']);
    expect($attempts)->toBe(1);
});
