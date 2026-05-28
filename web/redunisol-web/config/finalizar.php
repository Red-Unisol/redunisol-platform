<?php

return [
    'metamap' => [
        'client_id' => env('FINALIZAR_METAMAP_CLIENT_ID'),
    ],

    'legacy_clients' => [
        'caja' => [
            'base_url' => env('FINALIZAR_CAJA_API_BASE_URL'),
        ],
        'fiat' => [
            'base_url' => env('FINALIZAR_FIAT_API_BASE_URL'),
        ],
        'timeout_seconds' => (int) env('FINALIZAR_API_TIMEOUT_SECONDS', 30),
    ],

    'its' => [
        'base_url' => env('FINALIZAR_ITS_API_BASE_URL'),
        'api_key' => env('FINALIZAR_ITS_API_KEY'),
        'user' => env('FINALIZAR_ITS_API_USER'),
        'password' => env('FINALIZAR_ITS_API_PASSWORD'),
        'timeout_seconds' => (int) env('FINALIZAR_ITS_API_TIMEOUT_SECONDS', 25),
    ],

    'default_line' => 'caja',

    'lines' => [
        'amejuca' => [
            'flow_id' => '6453eb1ed9e6ce001d5b3858',
            'doc_id' => '4f4a8d2a-f361-49b5-9532-0528a83516e2',
            'extra_html' => '',
        ],
        'validacionSimple' => [
            'flow_id' => '65d777caa17afe001b769750',
            'doc_id' => 'f82f2536-19c1-4b16-bd69-feb94264da25',
            'extra_html' => '',
        ],
        'patagoniaSur' => [
            'flow_id' => '64be9a7188273d001bd45c98',
            'doc_id' => '0ffc9db9-9250-4afe-a555-decf80fcc166',
            'extra_html' => '',
        ],
        'centroComercial' => [
            'flow_id' => '65d8a26fge90634e001cbb4e89',
            'doc_id' => 'f70c8f4b-5792-41ec-b2af-1328490d054c',
            'extra_html' => '<a href="https://redunisol.com.ar/TyC/Terminos_Condiciones_CentroComercial.pdf" target="_blank" rel="noopener noreferrer">Terminos y condiciones Centro Comercial</a>',
        ],
        'mudon' => [
            'flow_id' => '63906e4db76a55001cb05858',
            'doc_id' => 'aefde31f-2eb8-46a8-b52b-6bb651d0c8a4',
            'extra_html' => '<p>Autorizo a descontar con mis haberes el porcentaje establecido para cuota social de MUDON y otros conceptos en forma permanente.</p><p>En caso de dudas comunicarse con MUDON al 08109995524.</p><p><a href="https://www.mudon.org.ar/" target="_blank" rel="noopener noreferrer">Beneficios MUDON</a></p>',
        ],
        'muci' => [
            'flow_id' => '65f9c9dbd68965001cf0babc',
            'doc_id' => '28914047-252d-47ab-ab68-160bbd3570eb',
            'extra_html' => '',
        ],
        'sanatorio_muci' => [
            'flow_id' => '6926f5a9f91f2f1452510470',
            'doc_id' => '84142a78-545b-4684-bd0f-997befe6cf45',
            'extra_html' => '',
        ],
        'caja' => [
            'flow_id' => '66143f63a6c0b9001c9d8e57',
            'doc_id' => 'c617b2a4-9efc-4cda-8d69-9a20f3d8a1e7',
            'extra_html' => '',
        ],
        'sanatorio_caja' => [
            'flow_id' => '6926ffc1bea61b3cf126e67e',
            'doc_id' => 'a82d8a5a-d016-4c56-9dc2-46e3b63860b3',
            'extra_html' => '',
        ],
        'ammer' => [
            'flow_id' => '6453f810e71757001c75789f',
            'doc_id' => '0506e488-7d02-4f09-9bb3-2b64882228be',
            'extra_html' => '<p>Autorizo a descontar con mis haberes el porcentaje establecido para cuota social de AMMER y otros conceptos en forma permanente.</p><p>En caso de dudas comunicarse con AMMER al 08005550567.</p><p><a href="http://mutualmodelo.com.ar/servicios/" target="_blank" rel="noopener noreferrer">Beneficios AMMER</a></p>',
        ],
        'mupolcbu' => [
            'flow_id' => '6453e4f8e71757001c7558c3',
            'doc_id' => '69602c4d-7154-4bb0-9677-c2d2443d58f1',
            'extra_html' => '',
        ],
        'mupolhaberes' => [
            'flow_id' => '6453e4f8e71757001c7558c3',
            'doc_id' => '2b28f4ca-0abf-4b33-9a3a-4ae418cf5368',
            'extra_html' => '<p>Autorizo a descontar con mis haberes el porcentaje establecido para cuota social de MUPOL y otros conceptos en forma permanente.</p><p>En caso de dudas comunicarse con MUPOL al 08109995524.</p><p><a href="https://www.redunisol.com.ar/mupol.html" target="_blank" rel="noopener noreferrer">Beneficios Mupol</a></p>',
        ],
        'amefac' => [
            'flow_id' => '64809dde4b8c37001c358432',
            'doc_id' => '2468305d-7e79-45c4-a557-27d9ac480f10',
            'extra_html' => '',
        ],
        'ameppc' => [
            'flow_id' => '682b23ef399fad001d8ac7f6',
            'doc_id' => 'edb6ec63-37b6-4303-9f51-2dd833857740',
            'extra_html' => '',
        ],
        'fiat' => [
            'flow_id' => '6453f8ecf6fa8c001c7b15e6',
            'doc_id' => 'f6aad70e-d611-4efd-a3ee-8b08487e89c4',
            'extra_html' => '',
        ],
        'fiat_celesol' => [
            'flow_id' => '6453f8ecf6fa8c001c7b15e6',
            'doc_id' => 'f6aad70e-d611-4efd-a3ee-8b08487e89c4',
            'extra_html' => '',
        ],
        'medicarosario' => [
            'flow_id' => '6797c69be63804001c1be567',
            'doc_id' => '184523eb-97bc-4a65-b6f7-e399c886ae7e',
            'extra_html' => '',
        ],
        'amelar' => [
            'flow_id' => '69400e550caae455e0fa15d6',
            'doc_id' => 'f7d2c0cb-bd46-4f25-87e6-7a6957b11481',
            'extra_html' => '',
        ],
    ],
];
