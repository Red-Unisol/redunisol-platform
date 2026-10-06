<?php

return [
    'directory' => env('PADRONES_DIRECTORY', storage_path('app/private/padrones')),
    'max_rows' => 100000,
    'max_columns' => 60,
    'max_upload_kb' => 20480,
    'sources' => [
        ['Administración', 'Padrón de empleados de Administración', 'padron', ['CUIL', 'nombres', 'Neto'], 2],
        ['Educación', 'Padrón de empleados de Educación', 'padron', ['CUIL', 'nombres'], 1],
        ['Bajas de agentes', 'Bajas informadas; contrastar fecha y causa con los demás padrones', 'bajas', ['Documento', 'Nombres', 'fechabaja', 'CausaBja'], 1],
        ['Senado', 'Planta activa de la Cámara de Senadores', 'padron', ['Nro. Documento', 'Apellido', 'Nombre', 'Sueldo Neto Total'], 1],
        ['Organismos y dependencias', 'Referencia de organismo y dependencia para AMEJUCA', 'padron', ['', 'DEPEN', 'CUIL', 'NOMBRE', 'ORGANISMO'], 2],
    ],
];
