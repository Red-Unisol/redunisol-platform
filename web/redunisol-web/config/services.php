<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'gtm' => [
        'id'      => env('GTM_ID'),
        'auth'    => env('GTM_AUTH'),
        'preview' => env('GTM_PREVIEW'),
    ],

    'kestra' => [
        'form_webhook_url' => env('KESTRA_FORM_WEBHOOK_URL'),
        'form_webhook_timeout_seconds' => (int) env('KESTRA_FORM_WEBHOOK_TIMEOUT_SECONDS', 60),
        'default_lead_source' => env('KESTRA_FORM_DEFAULT_LEAD_SOURCE', 'Google'),
    ],

];
