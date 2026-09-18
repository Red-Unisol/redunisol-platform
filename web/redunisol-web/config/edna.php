<?php

return [
    'enabled' => (bool) env('EDNA_INCOMING_ENABLED', false),
    // This is the inbound webhook key, NOT the key used to call the Edna API.
    'webhook_key' => env('EDNA_INCOMING_WEBHOOK_KEY', ''),
    'auth_header' => env('EDNA_INCOMING_AUTH_HEADER', 'Authorization'),
    'subject_id' => (string) env('EDNA_INCOMING_SUBJECT_ID', ''),
    'kestra_url' => env('KESTRA_EDNA_INCOMING_WEBHOOK_URL', ''),
    'router_enabled' => (bool) env('EDNA_ROUTER_ENABLED', false),
    'router_start_at' => env('EDNA_ROUTER_START_AT', ''),
    'router_recipients' => array_values(array_filter(array_map('trim', explode(',', env('EDNA_ROUTER_RECIPIENTS', ''))))),
    'api_key' => env('EDNA_API_KEY', ''),
    'cascade_id' => (string) env('EDNA_ROUTER_CASCADE_ID', ''),
];
