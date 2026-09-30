<?php

return [
    // Enable only after web migrations, Kestra files and CRM schema are deployed.
    'enabled' => (bool) env('ATTRIBUTION_ENABLED', false),
    'days' => 30,
];
