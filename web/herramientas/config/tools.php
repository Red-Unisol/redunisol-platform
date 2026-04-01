<?php

return [
    'branding' => [
        'eyebrow' => 'Asociacion Mutual Celesol',
        'title' => 'Herramientas Red Unisol',
        'headline' => 'Un acceso claro a automatizaciones y reportes operativos.',
        'description' => 'Unificamos en un solo lugar las herramientas que el equipo usa todos los dias, con una experiencia consistente, sobria y lista para crecer modulo por modulo.',
        'support_label' => 'Solicitar una nueva herramienta',
        'support_url' => 'https://wa.me/+5493516611746',
        'support_copy' => 'Cada nueva herramienta puede sumarse manualmente sin cambiar la identidad visual del hub.',
    ],
    'catalog' => [
        [
            'id' => 'consulta-renovacion-cruz-del-eje',
            'title' => 'Consulta Renovacion Cruz del Eje',
            'description' => 'Ingresa un CUIL y consulta si el socio puede renovar su prestamo, con respuesta directa del flujo de analisis de credito.',
            'category' => 'Analisis de credito',
            'status' => 'active',
            'icon' => 'credit-path',
            'actionLabel' => 'Consultar renovacion',
            'helper' => 'La consulta usa el webhook protegido de Kestra desde el backend Laravel.',
        ],
        [
            'id' => 'consulta-tope-descuento-caja',
            'title' => 'Consulta Tope Descuento Caja',
            'description' => 'Ingresa un CUIL y consulta el tope de descuento en Caja Jubilaciones.',
            'category' => 'Analisis de credito',
            'status' => 'active',
            'icon' => 'credit-path',
            'actionLabel' => 'Consultar caja',
            'helper' => 'La consulta usa el webhook protegido de Kestra desde el backend Laravel.',
        ],
    ],
    'proxy' => [
        'consulta_renovacion_url' => env('ANALISIS_CREDITO_RENOVACION_WEBHOOK_URL'),
        'tope_descuento_caja_url' => env('ANALISIS_CREDITO_CONSULTA_CAJA'),
        'timeout_seconds' => (int) env('ANALISIS_CREDITO_TIMEOUT_SECONDS', 30),
    ],
];
