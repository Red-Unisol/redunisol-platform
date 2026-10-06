<?php

namespace App\Http\Controllers;

use App\Support\BitrixRoutingConfig;
use App\Support\BitrixVolumeAllocator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;

class BitrixVolumeAllocationController extends Controller
{
    public function __invoke(Request $request, BitrixVolumeAllocator $allocator): JsonResponse
    {
        $token = (string) config('services.bitrix_routing.allocation_token');
        if ($token === '') {
            return response()->json(['message' => 'La compensación de volumen no está configurada.'], 503);
        }
        if (! hash_equals($token, (string) $request->bearerToken())) {
            return response()->json(['message' => 'No autorizado.'], 401);
        }

        $data = $request->validate([
            'scope' => ['required', 'string', 'max:120', 'regex:/^[A-Za-z0-9._-]+$/'],
            'bucket' => ['required', 'string', 'in:'.implode(',', array_keys(BitrixRoutingConfig::BUCKETS))],
            'deal_id' => ['required', 'integer', 'min:1'],
            'online_user_ids' => ['required', 'array', 'min:1'],
            'online_user_ids.*' => ['integer', 'min:1', 'distinct'],
            'proposed_user_id' => ['required', 'integer', 'min:1'],
            'recurring' => ['required', 'boolean'],
        ]);

        try {
            return response()->json($allocator->allocate(
                $data['scope'],
                $data['bucket'],
                $data['deal_id'],
                $data['online_user_ids'],
                $data['proposed_user_id'],
                $data['recurring'],
            ));
        } catch (InvalidArgumentException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }
}
