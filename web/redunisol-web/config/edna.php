<?php

return [
    'enabled' => (bool) env('EDNA_INCOMING_ENABLED', false),
    // This is the inbound webhook key, NOT the key used to call the Edna API.
    'webhook_key' => env('EDNA_INCOMING_WEBHOOK_KEY', ''),
    'auth_header' => env('EDNA_INCOMING_AUTH_HEADER', 'X-API-KEY'),
    'subject_id' => (string) env('EDNA_INCOMING_SUBJECT_ID', ''),
    'kestra_url' => env('KESTRA_EDNA_INCOMING_WEBHOOK_URL', ''),
];
