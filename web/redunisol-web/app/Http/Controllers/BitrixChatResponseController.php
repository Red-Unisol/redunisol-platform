<?php

namespace App\Http\Controllers;

use App\Services\BitrixChatResponseQueue;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BitrixChatResponseController extends Controller
{
    public function __invoke(Request $request, string $action, BitrixChatResponseQueue $queue): JsonResponse
    {
        $token = (string) config('services.bitrix_routing.allocation_token');
        if ($token === '' || ! hash_equals($token, (string) $request->bearerToken())) {
            return response()->json(['error' => 'unauthorized'], 401);
        }
        if ($request->input('scope') !== config('chat_response.scope')) {
            return response()->json(['error' => 'wrong_scope'], 403);
        }
        if ($action === 'claim') {
            return response()->json($queue->claim());
        }
        if ($action === 'enqueue') {
            $data = $request->validate(['deal_id' => ['required', 'integer', 'min:1'],
                'source' => ['required', 'string', 'max:100', 'regex:/^[A-Za-z0-9._-]+$/']]);
            $queue->deal($data['deal_id'], $data['source']);

            return response()->json(['ok' => true]);
        }
        $data = $request->validate(['lease' => ['required', 'uuid'],
            'outcome' => [$action === 'finish' ? 'required' : 'nullable', 'in:completed,retry,error'],
            'cursor' => [$action === 'finish' ? 'required' : 'nullable', 'integer', 'min:0'],
            'calls' => ['sometimes', 'integer', 'min:0', 'max:20'],
            'moved' => ['sometimes', 'integer', 'min:0', 'max:20']]);
        try {
            $queue->updateLease($data['lease'], $action === 'finish' ? array_diff_key($data, ['lease' => true]) : null);
        } catch (\DomainException) {
            return response()->json(['error' => 'stale_lease'], 409);
        }

        return response()->json(['ok' => true]);
    }
}
