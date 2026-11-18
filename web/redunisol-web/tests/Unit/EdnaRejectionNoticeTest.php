<?php

use App\Services\EdnaRejectionNotice;

function rejectionNoticeCatalog(): array
{
    return json_decode(file_get_contents(dirname(__DIR__, 2).'/resources/crm/rejection-notices.json'), true, 32, JSON_THROW_ON_ERROR);
}

function withRejectionNoticeCatalog(array $catalog, callable $check): void
{
    $file = tempnam(sys_get_temp_dir(), 'notice-test-');
    try {
        file_put_contents($file, json_encode($catalog, JSON_THROW_ON_ERROR));
        $check(new EdnaRejectionNotice($file));
    } finally {
        unlink($file);
    }
}

test('the checked in public notice catalog is reproducible from the canonical BPT builder', function () {
    require_once dirname(__DIR__, 2).'/tools/build-rejection-notices.php';
    $catalog = rejectionNoticeCatalog();
    expect(buildRejectionNoticeCatalog(dirname(__DIR__, 4)))->toBe($catalog)
        ->and($catalog['notices'])->toHaveCount(14)
        ->and(array_column($catalog['notices'], 'source_template_id'))->toContain(387, 407)
        ->and($catalog['without_public_chat'])->toBe(['OTRA PROVINCIA', 'NUMERO INCORRECTO']);
});

test('every active public notice matches only its complete copy and rejection reason', function (array $notice) {
    $service = new EdnaRejectionNotice;
    expect($service->match($notice['text'], $notice['reason_label']))->toBe(['template_sha256' => $notice['template_sha256']])
        ->and($service->match($notice['text'], 'UNKNOWN REASON'))->toBeNull()
        ->and($service->match('Mensaje anterior: '.$notice['text'], $notice['reason_label']))->toBeNull()
        ->and($service->match($notice['text'].' Mensaje posterior.', $notice['reason_label']))->toBeNull()
        ->and($service->match(mb_substr(trim($notice['text']), 0, -1), $notice['reason_label']))->toBeNull();
})->with(function () {
    foreach (rejectionNoticeCatalog()['notices'] as $notice) {
        yield $notice['reason_label'] => [$notice];
    }
});

test('convenio uses the generated public chat rather than either original email', function () {
    $notice = collect(rejectionNoticeCatalog()['notices'])->firstWhere('source_template_id', 407);
    expect((new EdnaRejectionNotice)->match($notice['text'], 'NO CUMPLE REQUISITOS PARA CONVENIO'))
        ->toBe(['template_sha256' => '102a4ae66bae8e917cbcf94f20bf2f64d74f00796cba72abb9087a06d425f49a']);
});

test('only line endings and outer ASCII whitespace are normalized', function () {
    $notice = collect(rejectionNoticeCatalog()['notices'])->firstWhere('source_template_id', 407);
    $service = new EdnaRejectionNotice;
    expect($service->match(" \t\r\n".str_replace("\n", "\r\n", $notice['text'])."\r\n\t ", " \t".$notice['reason_label']."\n"))
        ->toBe(['template_sha256' => $notice['template_sha256']])
        ->and($service->match(str_replace('Hola', 'HOLA', $notice['text']), $notice['reason_label']))->toBeNull()
        ->and($service->match(str_replace("\n\n", "\n", $notice['text']), $notice['reason_label']))->toBeNull()
        ->and($service->match(str_replace('👋', '', $notice['text']), $notice['reason_label']))->toBeNull()
        ->and($service->match("\0".$notice['text'], $notice['reason_label']))->toBeNull()
        ->and($service->match($notice['text'], strtolower($notice['reason_label'])))->toBeNull();
});

test('identical jubilado notices still require a cataloged matching reason', function () {
    $notice = collect(rejectionNoticeCatalog()['notices'])->firstWhere('source_template_id', 695);
    $service = new EdnaRejectionNotice;
    expect($service->match($notice['text'], 'JUBILADO PROVINCIAL'))->not->toBeNull()
        ->and($service->match($notice['text'], 'JUBILADO NACIONAL'))->not->toBeNull()
        ->and($service->match($notice['text'], 'PENSIONADO'))->toBeNull();
});

test('invalid or uncataloged input cannot prove a notice', function (string $text, string $reason) {
    expect((new EdnaRejectionNotice)->match($text, $reason))->toBeNull();
})->with([['', 'AUTONOMO'], [" \n ", 'AUTONOMO'], ['rechazado', 'AUTONOMO'],
    ["\xFF", 'AUTONOMO'], [str_repeat('x', 20001), 'AUTONOMO'], ['Sin respuesta', 'SIN RESPUESTA']]);

test('missing or invalid catalog files fail closed', function () {
    expect((new EdnaRejectionNotice(__DIR__.'/missing-notice-catalog.json'))->match('texto', 'AUTONOMO'))->toBeNull();
    $file = tempnam(sys_get_temp_dir(), 'notice-test-');
    try {
        file_put_contents($file, '{invalid');
        expect((new EdnaRejectionNotice($file))->match('texto', 'AUTONOMO'))->toBeNull();
    } finally {
        unlink($file);
    }
});

test('catalog drift and ambiguity cannot authorize a match', function (string $change) {
    $catalog = rejectionNoticeCatalog();
    $notice = $catalog['notices'][0];
    match ($change) {
        'schema' => $catalog['schema_version'] = 2,
        'normalization' => $catalog['normalization'] = 'words-only',
        'raw hash' => $catalog['notices'][0]['template_sha256'] = str_repeat('0', 64),
        'normalized hash' => $catalog['notices'][0]['normalized_sha256'] = str_repeat('0', 64),
        'copy' => $catalog['notices'][0]['text'] .= ' changed',
        'duplicate reason' => $catalog['notices'][] = $notice,
        'missing text' => $catalog['notices'][0]['text'] = null,
    };
    withRejectionNoticeCatalog($catalog, function ($service) use ($notice) {
        expect($service->match($notice['text'], $notice['reason_label']))->toBeNull();
    });
})->with(['schema', 'normalization', 'raw hash', 'normalized hash', 'copy', 'duplicate reason', 'missing text']);

test('uninterpreted document and variable expressions are never matched as public copy', function (string $expression) {
    $catalog = rejectionNoticeCatalog();
    $catalog['notices'][0]['text'] = 'Hola '.$expression.', no podemos avanzar.';
    $catalog['notices'][0]['template_sha256'] = hash('sha256', $catalog['notices'][0]['text']);
    $catalog['notices'][0]['normalized_sha256'] = $catalog['notices'][0]['template_sha256'];
    $notice = $catalog['notices'][0];
    withRejectionNoticeCatalog($catalog, function ($service) use ($notice) {
        expect($service->match($notice['text'], $notice['reason_label']))->toBeNull();
    });
})->with(['{=Document:NAME}', '{{customer}}', '${customer}']);

test('catalog generation never treats system or conditional copy as an unconditional public notice', function () {
    require_once dirname(__DIR__, 2).'/tools/build-rejection-notices.php';
    expect(fn () => rejectionNoticePublicChats(['Type' => 'ImOpenLinesMessageActivity',
        'Properties' => ['IsSystem' => 'Y', 'MessageText' => 'internal rejection']]))->toThrow(RuntimeException::class)
        ->and(fn () => rejectionNoticePublicChats(['Type' => 'IfElseActivity']))->toThrow(RuntimeException::class)
        ->and(rejectionNoticePublicChats(['Type' => 'ImOpenLinesMessageActivity', 'Activated' => 'N',
            'Properties' => ['IsSystem' => 'N', 'MessageText' => 'disabled copy']]))->toBe([]);
});
