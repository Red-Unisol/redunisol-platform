<?php

namespace App\Http\Controllers;

use App\Services\CommercialChatReadiness;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BitrixChatReadinessController extends Controller
{
    private function unauthorized(Request $request): ?JsonResponse
    {
        $token = (string) config('services.bitrix_routing.allocation_token');

        return $token !== '' && hash_equals($token, (string) $request->bearerToken())
            ? null : response()->json([], $token === '' ? 503 : 401);
    }

    public function candidates(Request $request, \App\Services\CommercialChatCandidates $candidates): JsonResponse
    {
        if ($error = $this->unauthorized($request)) {
            return $error;
        }
        $data = $request->validate(['channel' => ['required', 'in:web,v3,outbound'], 'after' => ['required', 'integer', 'min:0']]);

        return response()->json($candidates->page($data['channel'], (int) $data['after']))->header('Cache-Control', 'no-store');
    }

    public function __invoke(Request $request, CommercialChatReadiness $readiness): JsonResponse
    {
        if ($error = $this->unauthorized($request)) {
            return $error;
        }
        $data = $request->validate([
            'live' => ['required', 'boolean'],
            'cases' => ['required', 'array', 'list', 'min:1', 'max:'.($request->boolean('live') ? 1 : 50)],
            'cases.*.deal_id' => ['required', 'integer', 'min:1', 'distinct'],
            'cases.*.lead_id' => ['required', 'integer', 'min:1'],
            'cases.*.channel' => ['required', 'in:web,v3'],
            'cases.*.request_id' => ['required', 'uuid', 'distinct'],
        ]);

        return response()->json(['cases' => $readiness->check($data['cases'], $request->boolean('live'))])
            ->header('Cache-Control', 'no-store');
    }
}
