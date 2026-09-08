<?php

namespace App\Support;

use App\Models\BitrixRoutingAllocation;
use App\Models\BitrixRoutingDailyBalance;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

class BitrixVolumeAllocator
{
    public function __construct(private readonly BitrixRoutingConfig $routingConfig) {}

    public function allocate(
        string $scope,
        string $bucket,
        int $dealId,
        array $onlineUserIds,
        int $proposedUserId,
        bool $recurring,
    ): array {
        $activePool = $this->routingConfig->activePools()[$bucket] ?? null;
        if ($activePool === null) {
            throw new InvalidArgumentException('El bucket de distribución no existe.');
        }

        $online = collect($activePool)
            ->filter(fn (int $userId): bool => in_array($userId, $onlineUserIds, true))
            ->values()
            ->all();
        if (! in_array($proposedUserId, $online, true)) {
            throw new InvalidArgumentException('El vendedor propuesto no está habilitado y online en el bucket.');
        }

        $existing = BitrixRoutingAllocation::query()
            ->where('scope', $scope)
            ->where('deal_id', $dealId)
            ->first();
        if ($existing) {
            return $this->response($existing);
        }

        $businessDate = CarbonImmutable::now('America/Argentina/Cordoba')->toDateString();

        return Cache::lock("bitrix-routing-volume:{$scope}:{$businessDate}:{$bucket}", 10)
            ->block(5, function () use ($scope, $bucket, $dealId, $online, $proposedUserId, $recurring, $businessDate): array {
                return DB::transaction(function () use ($scope, $bucket, $dealId, $online, $proposedUserId, $recurring, $businessDate): array {
                    $existing = BitrixRoutingAllocation::query()
                        ->where('scope', $scope)
                        ->where('deal_id', $dealId)
                        ->first();
                    if ($existing) {
                        return $this->response($existing);
                    }

                    $balance = BitrixRoutingDailyBalance::query()->firstOrCreate(
                        ['scope' => $scope, 'business_date' => $businessDate, 'bucket' => $bucket],
                        ['expected' => [], 'assigned' => [], 'recent_assignees' => []],
                    );
                    $expected = $balance->expected ?? [];
                    $assigned = $balance->assigned ?? [];
                    $share = 1 / count($online);
                    foreach ($online as $userId) {
                        $key = (string) $userId;
                        $expected[$key] = (float) ($expected[$key] ?? 0) + $share;
                        $assigned[$key] = (int) ($assigned[$key] ?? 0);
                    }

                    $nonRecurringCount = $balance->non_recurring_count + ($recurring ? 0 : 1);
                    $every = max(1, (int) config('services.bitrix_routing.compensation_every', 4));
                    $compensationTurn = ! $recurring
                        && count($online) > 1
                        && $nonRecurringCount % $every === 0;
                    $assignedUserId = $proposedUserId;

                    if ($compensationTurn) {
                        $assignedUserId = $this->mostUnderTarget(
                            $online,
                            $proposedUserId,
                            $expected,
                            $assigned,
                            $balance->recent_assignees ?? [],
                        );
                    }

                    $assigned[(string) $assignedUserId]++;
                    $recentAssignees = array_slice([
                        ...($balance->recent_assignees ?? []),
                        $assignedUserId,
                    ], -2);
                    $balance->update([
                        'expected' => $expected,
                        'assigned' => $assigned,
                        'non_recurring_count' => $nonRecurringCount,
                        'recent_assignees' => $recentAssignees,
                    ]);

                    $allocation = BitrixRoutingAllocation::query()->create([
                        'scope' => $scope,
                        'deal_id' => $dealId,
                        'business_date' => $businessDate,
                        'bucket' => $bucket,
                        'online_user_ids' => $online,
                        'proposed_user_id' => $proposedUserId,
                        'assigned_user_id' => $assignedUserId,
                        'recurring' => $recurring,
                        'compensation_turn' => $compensationTurn,
                        'compensated' => $compensationTurn && $assignedUserId !== $proposedUserId,
                    ]);

                    return $this->response($allocation);
                });
            });
    }

    private function mostUnderTarget(
        array $online,
        int $proposedUserId,
        array $expected,
        array $assigned,
        array $recentAssignees,
    ): int {
        $proposedIndex = array_search($proposedUserId, $online, true);
        $ordered = [
            ...array_slice($online, $proposedIndex),
            ...array_slice($online, 0, $proposedIndex),
        ];
        $blocked = count($recentAssignees) === 2
            && $recentAssignees[0] === $recentAssignees[1]
            ? (int) $recentAssignees[0]
            : null;
        $eligible = count($ordered) > 1 && $blocked !== null
            ? array_values(array_filter($ordered, fn (int $userId): bool => $userId !== $blocked))
            : $ordered;

        $best = $eligible[0];
        $bestDeficit = -INF;
        foreach ($eligible as $userId) {
            $key = (string) $userId;
            $deficit = (float) ($expected[$key] ?? 0) - (int) ($assigned[$key] ?? 0);
            if ($deficit > $bestDeficit) {
                $best = $userId;
                $bestDeficit = $deficit;
            }
        }

        return $best;
    }

    private function response(BitrixRoutingAllocation $allocation): array
    {
        return [
            'deal_id' => $allocation->deal_id,
            'business_date' => (string) $allocation->business_date,
            'assigned_user_id' => $allocation->assigned_user_id,
            'recurring' => $allocation->recurring,
            'compensation_turn' => $allocation->compensation_turn,
            'compensated' => $allocation->compensated,
        ];
    }
}
