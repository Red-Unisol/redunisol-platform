<?php

namespace App\Http\Controllers;

use App\Services\WebFormReceipt;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WebFormReceiverController extends Controller
{
    public function __invoke(Request $request, WebFormReceipt $receipts): JsonResponse
    {
        $token = (string) config('services.bitrix_routing.allocation_token');
        if ($token === '' || ! hash_equals($token, (string) $request->bearerToken())) {
            return response()->json(['error' => 'unauthorized'], 401);
        }
        if ($request->input('scope') !== config('chat_response.scope')) {
            return response()->json(['error' => 'wrong_scope'], 403);
        }
        $data = $request->validate(['submission_id' => ['required', 'uuid'], 'digest' => ['required', 'regex:/^[a-f0-9]{64}$/D']]);

        return response()->json($receipts->claimWrite($data['submission_id'], $data['digest']));
    }
}
