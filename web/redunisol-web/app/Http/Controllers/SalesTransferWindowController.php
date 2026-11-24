<?php

namespace App\Http\Controllers;

use App\Services\EdnaBitrix;
use App\Services\SalesTransferWindow;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SalesTransferWindowController extends Controller
{
    public function __invoke(Request $request, SalesTransferWindow $window, EdnaBitrix $crm): JsonResponse
    {
        $token = (string) config('services.bitrix_routing.allocation_token');
        if ($token === '' || ! hash_equals($token, (string) $request->bearerToken())) {
            return response()->json(['error' => 'unauthorized'], 401);
        }
        if ($request->input('scope') !== config('chat_response.scope')) {
            return response()->json(['error' => 'wrong_scope'], 403);
        }
        $data = $request->validate(['chat_id' => ['required', 'integer', 'min:1'], 'session_id' => ['required', 'integer', 'min:1']]);

        return response()->json($window->inspect($crm, (int) $data['chat_id'], (int) $data['session_id']))->header('Cache-Control', 'no-store');
    }
}
