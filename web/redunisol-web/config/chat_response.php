<?php

return [
    'scope' => env('APP_ENV') === 'production' ? 'redunisol.prod.marketing-crm' : 'redunisol.dev.marketing-crm',
    'lease_seconds' => 180,
    'fallback_seconds' => 900,
];
