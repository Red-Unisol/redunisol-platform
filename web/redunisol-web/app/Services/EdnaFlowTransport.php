<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/** Keeps the business case stable while an audited resend has a new Edna UUID. */
class EdnaFlowTransport
{
    private const FIELDS = [
        'state', 'reason', 'send_started_at', 'accepted_at', 'outgoing_message_id',
        'response_event_id', 'completed_at', 'updated_at',
    ];

    public function id(object $send): string
    {
        return (string) (($send->transport_request_id ?? null) ?: $send->request_id);
    }

    /** Jobs without an explicit alias belong to the original attempt only. */
    public function matches(object $send, ?string $expectedTransportId): bool
    {
        return hash_equals($this->id($send), $expectedTransportId ?? (string) $send->request_id);
    }

    public function find(string $transportUuid): ?object
    {
        if (! Str::isUuid($transportUuid)) {
            return null;
        }
        $rows = DB::table('edna_flow_sends')->where(function ($query) use ($transportUuid): void {
            $query->where('transport_request_id', $transportUuid)
                ->orWhere(function ($original) use ($transportUuid): void {
                    $original->whereNull('transport_request_id')->where('request_id', $transportUuid);
                });
        })->limit(2)->get();
        if ($rows->count() > 1) {
            throw new RuntimeException('Ambiguous Flow transport identity.');
        }

        return $rows->first();
    }

    /** CAS both the active projection and its durable transport attempt. */
    public function update(object $send, array $allowedStates, array $fields): bool
    {
        if ($allowedStates === [] || $fields === [] || array_diff(array_keys($fields), self::FIELDS)) {
            throw new RuntimeException('Unsupported Flow transport transition.');
        }
        $fields['updated_at'] ??= now();

        return DB::transaction(function () use ($send, $allowedStates, $fields): bool {
            $query = DB::table('edna_flow_sends')->where('id', $send->id)
                ->where('request_id', $send->request_id)
                ->where('transport_request_id', $send->transport_request_id ?? null)
                ->whereIn('state', $allowedStates);
            if (! $query->update($fields)) {
                return false;
            }
            $alias = $send->transport_request_id ?? null;
            if ($alias !== null) {
                $updated = DB::table('edna_flow_send_attempts')->where('flow_send_id', $send->id)
                    ->where('transport_request_id', $alias)->update($fields);
                if ($updated !== 1) {
                    throw new RuntimeException('Active Flow transport archive is missing.');
                }
            }

            return true;
        });
    }
}
