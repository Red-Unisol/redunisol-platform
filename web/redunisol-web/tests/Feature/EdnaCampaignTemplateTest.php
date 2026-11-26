<?php

use App\Services\EdnaCampaignTemplate;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Http;

function campaignCallback(string $text = 'Sí, quiero activarla', string $type = 'BUTTON'): array
{
    return [
        'id' => '432', 'subjectId' => '22', 'subscriber' => ['identifier' => '5491100000000'],
        'receivedAt' => '2026-11-25T12:00:10.200Z', 'replyOutMessageId' => '123',
        'messageContent' => ['type' => $type, 'text' => $text, 'payload' => 'opaque-1'],
    ];
}

function campaignOriginal(int $id = 63508, string $name = 'aviso_billetera_v6link', string $label = 'Sí, quiero activarla'): array
{
    return [
        'messageId' => 123, 'matcherId' => $id, 'matcherName' => $name, 'subjectId' => 22,
        'address' => '5491100000000', 'direction' => 'OUT', 'channelType' => 'WHATSAPP',
        'deliveryStatus' => 'READ', 'sentOrReceivedAt' => '2026-11-25T11:59:50Z',
        'content' => ['keyboard' => ['rows' => [['buttons' => [
            ['type' => 'QUICK_REPLY', 'text' => $label, 'payload' => 'opaque-1'],
        ]]]]],
    ];
}

beforeEach(function () {
    config(['edna.subject_id' => 22, 'edna.api_key' => 'test']);
    $this->travelTo(CarbonImmutable::parse('2026-11-25T12:01:00Z'));
    Http::preventStrayRequests();
});

it('interprets the exact approved template and original quick reply', function (
    int $id, string $name, string $label, string $action, ?string $choice = null
) {
    $p = campaignCallback($label);
    $m = campaignOriginal($id, $name, $label);
    if ($choice !== null) {
        $p['messageContent']['payload'] = $label;
        $m['content']['keyboard']['rows'][0]['buttons'][0]['payload'] = $label;
    }
    Http::fake(['*/messages/history' => Http::response(['content' => [$m], 'hasNext' => false])]);
    $result = app(EdnaCampaignTemplate::class)->verifiedReply($p);
    $requiresWindow = in_array($action, ['continue', 'offer', 'clarify'], true) || $choice === 'yes';
    expect($result['action'])->toBe($action)->and($result['choice'] ?? null)->toBe($choice)
        ->and($result['outbound'])->toBe([
            'messageId' => '123', 'sentOrReceivedAt' => '2026-11-25T11:59:50.000000Z', 'matcherId' => (string) $id,
            'subjectId' => '22', 'matcherName' => $name,
        ] + ($requiresWindow ? ['uniqueAroundSend' => true] : []));
    Http::assertSentCount($requiresWindow ? 2 : 1);
})->with([
    [63508, 'aviso_billetera_v6link', 'Sí, quiero activarla', 'benefits'],
    [63510, 'aviso_soysocio_v6final', 'Más info', 'benefits'],
    [62718, 'aviso_billetera_v2', 'Si, quiero activarla', 'benefits'],
    [62723, 'aviso_billetera_v3', 'Ahora no', 'decline'],
    [63271, 'aviso_soysocio_v5', 'Darse de baja', 'unsubscribe'],
    [58749, 'reingreso_consent', 'Sí, quiero asesoramiento', 'continue'],
    [57692, 'respuesta_caja', 'Sí, quiero asesoramiento', 'offer'],
    [62517, 'jubilados_300', 'Sí, quiero asesoramiento', 'clarify'],
    [62276, 'prueba2_promo_jubilados_ola1', 'Consultar más adelante', 'defer'],
    [58478, 'recepcion_consentimiento_ok', 'No, gracias', 'form_consent', 'no'],
    [58478, 'recepcion_consentimiento_ok', 'Sí, quiero asesoramiento', 'form_consent', 'yes'],
]);

it('uses explicit quoted text or attachments for context without inferring new credit consent', function (
    int $id, string $name, string $type, string $text, string $action
) {
    $p = campaignCallback($text, $type);
    $m = campaignOriginal($id, $name);
    unset($m['content']['keyboard']);
    Http::fake(['*/messages/history' => Http::response(['content' => [$m], 'hasNext' => false])]);
    expect(app(EdnaCampaignTemplate::class)->verifiedReply($p)['action'])->toBe($action);
})->with([
    [62826, 'billetera_datos', 'TEXT', 'Mi billetera', 'benefits'],
    [63508, 'aviso_billetera_v6link', 'TEXT', 'No, gracias.', 'decline'],
    [55625, 'respuesta_reci', 'DOCUMENT', '', 'continue'],
    [59859, 'seguimiento_docu2', 'IMAGE', '', 'continue'],
    [57529, 'ingreso_firma', 'TEXT', 'Hola', 'clarify'],
    [62276, 'prueba2_promo_jubilados_ola1', 'AUDIO', '', 'clarify'],
    [58478, 'recepcion_consentimiento_ok', 'TEXT', 'Sí, quiero asesoramiento', 'clarify'],
    [61838, 'boton_home_atribucion', 'TEXT', '¿Cómo ingreso?', 'link'],
    [64262, 'acreditacion_resena_v2', 'TEXT', 'Buena atención', 'feedback'],
    [58130, 'encuesta_postpropuesta2', 'TEXT', 'No', 'feedback'],
]);

it('does not start verification for unquoted callbacks or for the organic menu’s own payload', function () {
    $p = campaignCallback();
    $p['messageContent']['payload'] = 'organic:unrelated';
    expect(app(EdnaCampaignTemplate::class)->verifiedReply($p))->toBeNull();
    unset($p['replyOutMessageId']);
    foreach (['DOCUMENT', 'TEXT', 'BUTTON'] as $type) {
        $p['messageContent'] = ['type' => $type, 'text' => 'Quiero más info'];
        expect(app(EdnaCampaignTemplate::class)->verifiedReply($p))->toBeNull();
    }
    Http::assertNothingSent();
});

it('retries incomplete evidence without reinterpreting a known campaign as organic', function (string $problem) {
    $p = campaignCallback();
    $m = campaignOriginal();
    $keyboard = &$m['content']['keyboard']['rows'][0]['buttons'];
    match ($problem) {
        'new option' => $p['messageContent']['text'] = 'Otra opción',
        'wrong matcher id' => $m['matcherId'] = 63507,
        'reused matcher name' => $m['matcherId'] = 99999,
        'missing matcher identity' => [$m['matcherId'], $m['matcherName']] = [null, null],
        'wrong case' => $p['messageContent']['text'] = 'Si, quiero activarla',
        'wrong payload' => $p['messageContent']['payload'] = 'opaque-2',
        'wrong subject' => $m['subjectId'] = 23,
        'wrong recipient' => $m['address'] = '5491199999999',
        'not delivered' => $m['deliveryStatus'] = 'SENT',
        'original after reply' => $m['sentOrReceivedAt'] = '2026-11-25T12:00:10.300Z',
        'URL button' => $keyboard[0]['type'] = 'URL',
        'duplicate button' => $keyboard[] = $keyboard[0],
        default => null,
    };
    Http::fake(['*/messages/history' => Http::response([
        'content' => $problem === 'original unavailable' ? [] : [$m], 'hasNext' => $problem === 'incomplete page',
    ], $problem === 'api unavailable' ? 503 : 200)]);
    expect(fn () => app(EdnaCampaignTemplate::class)->verifiedReply($p))->toThrow(RuntimeException::class);
    Http::assertSentCount(1);
})->with(['new option', 'wrong matcher id', 'reused matcher name', 'missing matcher identity', 'wrong case', 'wrong payload', 'wrong subject',
    'wrong recipient', 'not delivered', 'original after reply', 'URL button', 'duplicate button', 'original unavailable', 'incomplete page', 'api unavailable']);

it('leaves a confirmed unrelated template or ordinary quoted message to the channel handler', function (string $type) {
    $p = campaignCallback('Sí, quiero activarla', $type);
    $m = campaignOriginal(99999, 'otra_plantilla');
    if ($type === 'TEXT') {
        unset($m['matcherId'], $m['matcherName']);
    }
    Http::fake(['*/messages/history' => Http::response(['content' => [$m], 'hasNext' => false])]);
    expect(app(EdnaCampaignTemplate::class)->verifiedReply($p))->toBeNull();
    Http::assertSentCount(1);
})->with(['TEXT', 'BUTTON']);

it('distinguishes a verified commercial reply from a unique CRM emission', function () {
    $p = campaignCallback('Sí, quiero asesoramiento');
    $m = campaignOriginal(58749, 'reingreso_consent', 'Sí, quiero asesoramiento');
    $duplicate = array_replace($m, ['messageId' => 124, 'sentOrReceivedAt' => '2026-11-25T11:59:52Z']);
    Http::fake(['*/messages/history' => fn ($r) => Http::response([
        'content' => isset($r['messageId']) ? [$m] : [$duplicate, $m], 'hasNext' => false,
    ])]);
    $result = app(EdnaCampaignTemplate::class)->verifiedReply($p);
    expect($result['action'])->toBe('continue')->and($result['outbound']['messageId'])->toBe('123')
        ->and($result['outbound']['uniqueAroundSend'])->toBeFalse();
    Http::assertSentCount(2);
});
