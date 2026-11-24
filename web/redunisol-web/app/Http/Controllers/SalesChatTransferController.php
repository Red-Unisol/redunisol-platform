<?php

namespace App\Http\Controllers;

use App\Services\SalesChatTransfer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SalesChatTransferController extends Controller
{
    public function __invoke(Request $request, SalesChatTransfer $delivery): JsonResponse
    {
        $token = (string) config('services.bitrix_routing.allocation_token');
        if ($token === '' || ! hash_equals($token, (string) $request->bearerToken())) {
            return response()->json(['error' => 'unauthorized'], 401);
        }
        if ($request->input('scope') !== config('chat_response.scope')) {
            return response()->json(['error' => 'wrong_scope'], 403);
        }
        if (! config('edna.kestra_chat_transfer_delivery_enabled')) {
            return response()->json(['error' => 'delivery_disabled'], 503);
        }

        $ids = ['required', 'integer', 'min:1'];
        $data = $request->validate(['chat_id' => $ids, 'session_id' => $ids, 'deal_id' => $ids, 'lead_id' => $ids,
            'target_id' => [...$ids, 'not_in:57,74827,71283'], 'contact_id' => ['nullable', 'integer', 'min:1'],
            'stage_id' => ['required', 'string', 'max:100']]);
        $key = ['scope' => config('chat_response.scope'), 'chat_id' => (int) $data['chat_id'], 'session_id' => (int) $data['session_id']];
        $assignment = ['deal_id' => (int) $data['deal_id'], 'lead_id' => (int) $data['lead_id'],
            'contact_id' => isset($data['contact_id']) ? (int) $data['contact_id'] : null,
            'stage_id' => $data['stage_id'], 'target_id' => (int) $data['target_id']];
        $query = DB::table(SalesChatTransfer::TABLE)->where($key);
        $row = $query->first();
        $created = false;
        if (! $row) {
            $reason = $delivery->reservationBlock((object) ($key + $assignment));
            if ($reason !== null) {
                $row = $query->first(); // Concurrent insert, including a replay whose HTTP acknowledgement was lost.
                if (! $row) {
                    return response()->json(['ok' => false, 'error' => $reason], $reason === 'case_binding_unverified' ? 503 : 422);
                }
            } else {
                $now = now()->utc();
                $created = DB::table(SalesChatTransfer::TABLE)->insertOrIgnore($key + $assignment + [
                    'available_at' => $now, 'deadline_at' => $now->copy()->addHours(8), 'created_at' => $now, 'updated_at' => $now,
                ]);
                $row = $query->firstOrFail();
            }
        }
        $match = true;
        foreach ($assignment as $field => $value) {
            $match = $match && ((string) $row->$field === (string) $value);
        }

        return response()->json(['ok' => $match, 'request_id' => (int) $row->id, 'status' => $row->state,
            'deal_id' => (int) $row->deal_id, 'lead_id' => (int) $row->lead_id,
            'contact_id' => $row->contact_id === null ? null : (int) $row->contact_id,
            'target_id' => (int) $row->target_id, 'stage_id' => $row->stage_id] + $key, $match ? ($created ? 202 : 200) : 409)
            ->header('Cache-Control', 'no-store');
    }
}
