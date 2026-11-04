<?php

$namespace = env('CUAD_MASIVO_KESTRA_NAMESPACE', 'redunisol.dev.analisis-credito');

return [
    // Contraseña propia de esta herramienta (hash bcrypt), distinta de la de Análisis.
    'password_hash' => env('CUAD_MASIVO_PASSWORD_HASH', ''),
    // Misma conexión a Kestra que BCRA (usuario de la API de la instancia).
    'kestra_url' => rtrim((string) env('CUAD_MASIVO_KESTRA_URL', env('BCRA_KESTRA_URL', '')), '/'),
    'kestra_username' => env('CUAD_MASIVO_KESTRA_USERNAME', env('BCRA_KESTRA_USERNAME', '')),
    'kestra_password' => env('CUAD_MASIVO_KESTRA_PASSWORD', env('BCRA_KESTRA_PASSWORD', '')),
    'tenant' => env('CUAD_MASIVO_KESTRA_TENANT', env('BCRA_KESTRA_TENANT', 'main')),
    'namespace' => $namespace,
    'flow_id' => 'consulta_cuad_masivo',
    // Carpeta de corridas que escribe el flow, montada de solo lectura.
    'output_root' => env('CUAD_MASIVO_OUTPUT_ROOT', '/data/cuad-masivo/'.$namespace),
    // El segundo botón consulta siempre esta línea superior de Vimarx.
    'linea_superior' => ['id' => '2703', 'nombre' => 'Haberes CUAD SANTA FE'],
    'max_upload_kb' => 5120,
    // Una cuenta sin novedades por más de esto (fuera de una pausa) se muestra frenada.
    'frenada_segundos' => 300,
];
