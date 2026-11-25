<?php

use App\Services\EdnaFormConsent;
use Illuminate\Support\Facades\Http;

function formConsentCallback(string $label = 'Sí, quiero asesoramiento'): array
{
    return [
        'id' => '456', 'subjectId' => '22', 'subscriber' => ['identifier' => '5491100000000'],
        'receivedAt' => '2026-11-25T12:00:10.123Z', 'replyOutMessageId' => '123',
        'messageContent' => ['type' => 'BUTTON', 'text' => $label, 'payload' => $label],
    ];
}

function formConsentOriginal(): array
{
    return [
        'messageId' => 123, 'matcherId' => 58478, 'matcherName' => 'recepcion_consentimiento_ok',
        'direction' => 'OUT', 'channelType' => 'WHATSAPP', 'subjectId' => 22, 'address' => '5491100000000',
        'deliveryStatus' => 'DELIVERED', 'sentOrReceivedAt' => '2026-11-25T09:00:10.011-0300',
        'content' => json_encode(['keyboard' => ['rows' => [['buttons' => [
            ['text' => 'Sí, quiero asesoramiento', 'payload' => 'Sí, quiero asesoramiento'],
            ['text' => 'No, gracias', 'payload' => 'No, gracias'],
        ]]]]], JSON_THROW_ON_ERROR),
    ];
}

beforeEach(function () {
    config(['edna.subject_id' => '22', 'edna.api_key' => 'test']);
    Http::preventStrayRequests();
});

it('verifies the exact original and returns only technical evidence for the selected button', function (string $label, string $choice) {
    Http::fake(['app.edna.io/api/messages/history' => Http::response(['content' => [formConsentOriginal()], 'hasNext' => false])]);
    $this->travelTo(\Carbon\CarbonImmutable::parse('2026-11-25T12:00:20Z'));
    $result = app(EdnaFormConsent::class)->verifiedReply(formConsentCallback($label));
    expect($result)->toBe(['choice' => $choice, 'outbound' => [
        'messageId' => '123', 'sentOrReceivedAt' => '2026-11-25T12:00:10.011000Z',
        'matcherId' => '58478', 'subjectId' => '22',
    ] + ($choice === 'yes' ? ['uniqueAroundSend' => true] : [])]);
    Http::assertSent(fn ($r) => ($r['messageId'] ?? null) === 123 && $r['direction'] === 'OUT'
        && $r['subjectId'] === 22 && $r['channelTypes'] === ['WHATSAPP']
        && $r['subscriberFilter'] === ['address' => '5491100000000', 'type' => 'PHONE']);
})->with([['Sí, quiero asesoramiento', 'yes'], ['No, gracias', 'no']]);

it('leaves a different proven template with identical options in its own route', function () {
    $other = array_replace(formConsentOriginal(), ['matcherId' => 58749, 'matcherName' => 'reingreso_consent']);
    Http::fake(['app.edna.io/api/messages/history' => Http::response(['content' => [$other], 'hasNext' => false])]);
    expect(app(EdnaFormConsent::class)->verifiedReply(formConsentCallback()))->toBeNull();
});

it('never infers consent from an unquoted response or from a free-text message', function (string $type, ?string $mid) {
    Http::fake();
    $payload = formConsentCallback();
    $payload['messageContent']['type'] = $type;
    $payload['replyOutMessageId'] = $mid;
    $consent = app(EdnaFormConsent::class);
    expect($consent->candidate($payload))->toBeFalse()
        ->and($consent->verifiedReply($payload))->toBeNull();
    Http::assertNothingSent();
})->with([['TEXT', '123'], ['BUTTON', null]]);

it('keeps uncertain or contradictory evidence out of the organic fallback', function (string $scenario) {
    $m = formConsentOriginal();
    $p = formConsentCallback();
    match ($scenario) {
        'recipient' => $m['address'] = '5491199999999',
        'direction' => $m['direction'] = 'IN',
        'channel' => $m['channelType'] = 'SMS',
        'different subject' => $m['subjectId'] = 23,
        'different MID' => $m['messageId'] = 122,
        'pending delivery' => $m['deliveryStatus'] = 'ENQUEUED',
        'sent after click' => $m['sentOrReceivedAt'] = '2026-11-25T12:00:10.124Z',
        'missing timezone' => $m['sentOrReceivedAt'] = '2026-11-25T12:00:09',
        'inconsistent matcher' => $m['matcherName'] = 'reingreso_consent',
        'button payload mismatch' => $p['messageContent']['payload'] = 'No, gracias',
        'original keyboard missing' => $m['content'] = '{}',
        default => null,
    };
    $rows = match ($scenario) {
        'duplicate MID' => [$m, $m], 'history delayed' => [], default => [$m],
    };
    Http::fake(['app.edna.io/api/messages/history' => Http::response(
        ['content' => $rows, 'hasNext' => $scenario === 'truncated'], $scenario === 'outage' ? 503 : 200
    )]);
    expect(fn () => app(EdnaFormConsent::class)->verifiedReply($p))->toThrow(RuntimeException::class);
})->with(['recipient', 'direction', 'channel', 'different subject', 'different MID', 'pending delivery',
    'sent after click', 'missing timezone', 'inconsistent matcher', 'button payload mismatch', 'original keyboard missing',
    'duplicate MID', 'history delayed', 'truncated', 'outage']);

it('detects two possible emissions while keeping the customer reply tied to its exact outbound MID', function () {
    $this->travelTo(\Carbon\CarbonImmutable::parse('2026-11-25T12:00:20Z'));
    $original = formConsentOriginal();
    $duplicate = array_replace($original, ['messageId' => 124, 'sentOrReceivedAt' => '2026-11-25T12:00:14Z']);
    Http::fake(['app.edna.io/api/messages/history' => fn ($r) => Http::response([
        'content' => isset($r['messageId']) ? [$original] : [$duplicate, $original], 'hasNext' => false,
    ])]);
    $result = app(EdnaFormConsent::class)->verifiedReply(formConsentCallback());
    expect($result['choice'])->toBe('yes')->and($result['outbound']['uniqueAroundSend'])->toBeFalse();
});

it('waits if the click precedes the end of the native timestamp matching window', function () {
    $this->travelTo(\Carbon\CarbonImmutable::parse('2026-11-25T12:00:11Z'));
    Http::fake(['app.edna.io/api/messages/history' => Http::response(['content' => [formConsentOriginal()], 'hasNext' => false])]);
    expect(fn () => app(EdnaFormConsent::class)->verifiedReply(formConsentCallback()))->toThrow(RuntimeException::class, 'still open');
    Http::assertSentCount(1);
});

it('only recognizes the member benefits button on the exact delivered template', function (string $scenario) {
    $label = 'Quiero mis beneficios';
    $p = formConsentCallback($label);
    $m = array_replace(formConsentOriginal(), ['matcherId' => 63510, 'matcherName' => 'aviso_soysocio_v6final',
        'content' => ['keyboard' => ['rows' => [['buttons' => [['text' => $label, 'payload' => $label]]]]]]]);
    match ($scenario) {
        'other template' => [$m['matcherId'], $m['matcherName']] = [12345, 'otra_plantilla'],
        'text' => $p['messageContent']['type'] = 'TEXT',
        'no reply' => $p['replyOutMessageId'] = null,
        'different button' => $p['messageContent']['text'] = 'Otro botón',
        'payload mismatch' => $p['messageContent']['payload'] = 'otra_accion',
        default => null,
    };
    Http::fake(['app.edna.io/api/messages/history' => Http::response(['content' => [$m], 'hasNext' => false])]);
    $button = app(\App\Services\EdnaMemberBenefitsButton::class);
    if ($scenario === 'payload mismatch') {
        expect(fn () => $button->verifiedReply($p))->toThrow(RuntimeException::class);
    } else {
        expect($button->verifiedReply($p)['matcherId'] ?? null)->toBe($scenario === 'exact' ? '63510' : null);
    }
})->with(['exact', 'other template', 'text', 'no reply', 'different button', 'payload mismatch']);
