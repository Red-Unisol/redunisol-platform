<?php

return [
    'kestra_url' => env('REPORTS_KESTRA_URL'),
    'kestra_tenant' => env('REPORTS_KESTRA_TENANT', 'main'),
    'kestra_username' => env('REPORTS_KESTRA_USERNAME'),
    'kestra_password' => env('REPORTS_KESTRA_PASSWORD'),
    'namespace_prefix' => env('REPORTS_KESTRA_NAMESPACE_PREFIX', 'redunisol.prod'),
];
