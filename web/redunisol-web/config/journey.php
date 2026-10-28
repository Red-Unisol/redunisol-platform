<?php

return [
    'enabled' => (bool) env('JOURNEY_ENABLED', false),
    'root' => env('JOURNEY_ROOT', '/var/www/journey'),
    'environment' => env('JOURNEY_ENVIRONMENT', env('APP_ENV', 'local')),
    'min_free_bytes' => 536870912,
    'export_token' => env('JOURNEY_EXPORT_TOKEN', ''),
    'crm_enabled' => (bool) env('JOURNEY_CRM_ENABLED', false),
    'crm_since' => env('JOURNEY_CRM_SINCE', '2026-10-22T00:00:00-03:00'),
];
