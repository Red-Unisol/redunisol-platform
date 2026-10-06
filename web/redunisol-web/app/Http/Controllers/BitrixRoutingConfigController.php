<?php

namespace App\Http\Controllers;

use App\Support\BitrixRoutingConfig;
use Illuminate\Http\JsonResponse;

class BitrixRoutingConfigController extends Controller
{
    public function __invoke(BitrixRoutingConfig $config): JsonResponse
    {
        return response()->json($config->activePools());
    }
}
