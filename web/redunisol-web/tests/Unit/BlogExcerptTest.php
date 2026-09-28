<?php

use App\Support\BlogExcerpt;

it('extracts editorial text without styles scripts or technical elements', function () {
    $html = '<link rel="stylesheet" href="https://example.test/font.css">'
        .'<STYLE>.montserrat * { font-family: "Montserrat", sans-serif; }</STYLE>'
        .'<script>window.alert("technical");</script><template>hidden</template>'
        .'<div><p>Si sos <strong>jubilado</strong>&nbsp;provincial…</p><p>Consultá &amp; compará.</p></div>';

    expect(BlogExcerpt::fromHtml($html))->toBe('Si sos jubilado provincial… Consultá & compará.');
});

it('regenerates a legacy excerpt that has already lost its style tags', function () {
    expect(BlogExcerpt::resolve('.montserrat * { font-family: Montserrat; } Texto cortado...',
        '<style>.montserrat * { font-family: Montserrat; }</style><p>Texto editorial completo.</p>'))
        ->toBe('Texto editorial completo.');
});

it('preserves manual summaries and cleans markup without replacing editorial choices', function () {
    expect(BlogExcerpt::resolve('Resumen elegido por Marketing.', '<p>Otro comienzo.</p>'))
        ->toBe('Resumen elegido por Marketing.')
        ->and(BlogExcerpt::resolve("Resumen manual.\nSegunda línea.\n", '<p>Otro comienzo.</p>'))
        ->toBe("Resumen manual.\nSegunda línea.\n")
        ->and(BlogExcerpt::resolve('<style>p { color: red; }</style><b>Resumen</b> elegido.', '<p>Otro comienzo.</p>'))
        ->toBe('Resumen elegido.');
});

it('handles empty content line breaks comments and unicode limits', function () {
    expect(BlogExcerpt::resolve(null, ''))->toBe('')
        ->and(BlogExcerpt::fromHtml('<!-- hidden --><p>Crédito<br>Córdoba</p><ul><li>Uno</li><li>Dos</li></ul>'))
        ->toBe('Crédito Córdoba Uno Dos')
        ->and(BlogExcerpt::fromHtml('<p>'.str_repeat('á', 200).'</p>'))
        ->toBe(str_repeat('á', 160).'...');
});
