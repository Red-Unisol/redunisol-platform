<?php

return [
    'kestra_url' => rtrim((string) env('BCRA_KESTRA_URL', ''), '/'),
    'kestra_username' => env('BCRA_KESTRA_USERNAME', ''),
    'kestra_password' => env('BCRA_KESTRA_PASSWORD', ''),
    'tenant' => env('BCRA_KESTRA_TENANT', 'main'),
    'namespace' => env('BCRA_KESTRA_NAMESPACE', 'redunisol.dev.contabilidad'),
    'flow_id' => 'bcra_deudores_generate',
    'output_root' => env('BCRA_OUTPUT_ROOT', '/data/bcra/'.env('BCRA_KESTRA_NAMESPACE', 'redunisol.dev.contabilidad')),
    // Personal identifiers stay in the encrypted runtime, never in the repository.
    'excluded_cuits' => json_decode((string) env('BCRA_DEFAULT_EXCLUDED_CUITS', '[]'), true) ?: [],
    'excluded_superiors' => [
        'LINEAS CAJA JUBILADOS_FIAT', 'CUOTAS SOCIALES', 'LINEA MIS',
        'LINEA DEUDAS PASIVOS CELESOL', 'FONCAP Y VOLUNTARIOS', 'PYME CHEQUES PAGO INTEGRO',
        'LINEAS AMES', 'AMORTIZABLES USD', 'HABERES', 'LINEAS MAM', 'RED UNISOL',
        'SOEMC HABERES', 'CONVENIO AMA - FADEA',
        'CONVENIO 1', 'CONVENIO 2', 'CONVENIO 3', 'CONVENIO 4', 'CONVENIO 6',
        'CONVENIO 7', 'CONVENIO 8', 'CONVENIO 11', 'CONVENIO 14', 'CONVENIO 15',
        'CONVENIO 17', 'CONVENIO 18', 'CONVENIO 31', 'CONVENIO 35', 'CONVENIO 45',
        'CONVENIO 50', 'CONVENIO 60', 'CONVENIO 65', 'CONVENIO 70', 'CONVENIO 80', 'CONVENIO 80 SOEM',
    ],
    // Only Médica inside CUAD; MUCI and CAJA Desendeudamiento remain included.
    'excluded_cuad_products' => [
        'MEDICA ESPECIAL A', 'LINEA LA MEDICA ESPECIAL 24-36', 'MEDICA PREMIUM',
        'LINEA LA MEDICA PREMIUM 24-36', 'MEDICA PREMIUM +1', 'LIN LA MED PREM 24-36 MAS UNO',
        'MEDICA ESPECIAL +1 A', 'LIN LA MED ESPL 24-36 MAS UNO', 'MEDICA ESPECIAL B',
        'MEDICA ESPECIAL +1 B', 'MEDICA PLAN DESENDEUDAMIENTO',
    ],
];
