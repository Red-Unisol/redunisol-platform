<?php

return [
    'team' => ['dmontaña', 'aortega', 'jmarin', 'ssalguero'],
    'password_hash' => env('ANALISIS_PASSWORD_HASH', ''),
    'core_url' => env('ANALISIS_CORE_URL', ''),
    'core_token' => env('ANALISIS_CORE_TOKEN', ''),
    'verify_tls' => filter_var(env('ANALISIS_CORE_VERIFY_TLS', true), FILTER_VALIDATE_BOOLEAN),
    'timeout_seconds' => 20,
    'refresh_seconds' => 45,
    'cache_seconds' => 15,
    'cache_store' => env('ANALISIS_CACHE_STORE', 'file'),
    'max_rows' => 10000,

    // IDs from EstadoSolicitud. Values are the labels written in NovedadSolicitud.
    // Eligible known IDs: 114 RevisionRiesgo, 117 VerificacionDocumentacion,
    // 121 Confirmada, 123 A Transferir. New IDs are included by default.
    'excluded_states' => [
        0 => 'Procesando', 1 => 'Enviada', 2 => 'Aprobada', 3 => 'Rechazada',
        4 => 'Revisar', 5 => 'Pagada', 6 => 'Abandonada', 7 => 'Anulada',
        8 => 'CargaVendedor', 9 => 'EnviadaAFirmar', 10 => 'Firmada',
        100 => 'Motor', 110 => 'PreAprobado', 111 => 'RechazoMotor',
        112 => 'RevisionBackOffice', 113 => 'RevisionComercial', 115 => 'DictamenComite',
        116 => 'AprobacionSocio', 118 => 'Verificacion de Documentos y Firma',
        119 => 'VerificacionComite', 120 => 'VerificacionBackOffice',
        122 => 'Liquidada', 124 => 'Vencida',
    ],
    'display_states' => [
        114 => 'Revisión de riesgo', 117 => 'Verificar documentación',
        121 => 'Confirmada', 123 => 'A transferir',
    ],
];
