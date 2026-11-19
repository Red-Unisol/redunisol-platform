<?php

namespace App\Http\Controllers;

use App\Support\BitrixRoutingConfig;
use App\Support\WhatsAppOutOfHoursSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;

class BitrixRoutingConfigController extends Controller
{
    public function __invoke(Request $request, BitrixRoutingConfig $config, WhatsAppOutOfHoursSettings $hours): JsonResponse
    {
        $pools = $config->activePools();
        if ($request->query('include') === 'sales_calendar') {
            $pools['sales_calendar'] = Arr::only($hours->get(), ['timezone', 'open', 'close', 'weekdays', 'holidays']);
        }

        return response()->json($pools);
    }
}
