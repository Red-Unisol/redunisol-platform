<?php

return [
    // Enable only after web migrations, Kestra files and CRM schema are deployed.
    'enabled' => (bool) env('ATTRIBUTION_ENABLED', false),
    'days' => 30,
    // Public property already configured by GTM; keep aligned with that Google tag.
    'ga4_measurement_id' => 'G-RENEBND2BG',
];
