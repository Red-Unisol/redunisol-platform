<?php

namespace App\Support;

use App\Models\BitrixRoutingBucket;
use App\Models\BitrixRoutingSeller;
use App\Models\User;
use App\Services\BitrixUserDirectory;
use Filament\Facades\Filament;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class BitrixSellerRegistry
{
    public function enabledIds(): array
    {
        return BitrixRoutingSeller::query()->where('enabled', true)->orderBy('bitrix_user_id')->pluck('bitrix_user_id')->all();
    }

    public function revision(): int
    {
        return (int) DB::table('bitrix_routing_seller_changes')->max('id');
    }

    public function lock(?int $expectedRevision = null): void
    {
        BitrixRoutingSeller::query()->orderBy('bitrix_user_id')->lockForUpdate()->get();
        if ($expectedRevision !== null && $expectedRevision !== $this->revision()) {
            throw ValidationException::withMessages(['data.seller_ids' => 'La lista de vendedores cambió. Recargá la página antes de guardar.']);
        }
    }

    /** Names and lines to display in the confirmation before disabling accounts. */
    public function disablingImpact(array $selected): array
    {
        $removed = array_diff($this->enabledIds(), array_map('intval', $selected));
        $impact = [];
        foreach (app(BitrixRoutingConfig::class)->forForm() as $key => $sellers) {
            foreach ($sellers as $seller) {
                if (in_array($seller['user_id'], $removed, true)) {
                    $impact[$seller['user_id']][] = BitrixRoutingConfig::BUCKETS[$key]['label'];
                }
            }
        }

        return BitrixRoutingSeller::query()->whereIn('bitrix_user_id', $removed)->get()
            ->map(fn (BitrixRoutingSeller $seller): array => [
                'name' => $seller->label(), 'lines' => $impact[$seller->bitrix_user_id] ?? [],
            ])->all();
    }

    public function save(array $selected, int $expectedRevision, User $actor): void
    {
        abort_unless($actor->canAccessPanel(Filament::getPanel('admin')), 403);
        $validated = validator(['seller_ids' => $selected], [
            'seller_ids' => ['present', 'array'],
            'seller_ids.*' => ['required', 'integer', 'min:1', 'distinct'],
        ])->validate();
        $ids = array_map('intval', $validated['seller_ids']);
        sort($ids);
        // Never trust profile labels or activity supplied by the browser/cache when enabling.
        $users = app(BitrixUserDirectory::class)->users(fresh: true);
        foreach ($ids as $id) {
            if (! ($users[$id]['active'] ?? false)) {
                throw ValidationException::withMessages(['data.seller_ids' => 'Una cuenta seleccionada ya no está activa en Bitrix. Actualizá la lista y revisá la selección.']);
            }
        }

        DB::transaction(function () use ($ids, $users, $actor, $expectedRevision): void {
            $this->lock($expectedRevision);
            $before = $this->enabledIds();
            $removed = array_diff($before, $ids);
            $paused = $this->pauseRemovedSellers($removed);

            BitrixRoutingSeller::query()->whereNotIn('bitrix_user_id', $ids)->update(['enabled' => false]);
            foreach ($ids as $id) {
                BitrixRoutingSeller::query()->updateOrCreate(['bitrix_user_id' => $id], [
                    'name' => $users[$id]['name'], 'email' => $users[$id]['email'] ?: null, 'enabled' => true,
                ]);
            }
            DB::table('bitrix_routing_seller_changes')->insert([
                'actor_id' => $actor->id, 'before_ids' => json_encode($before), 'after_ids' => json_encode($ids),
                'paused_buckets' => json_encode($paused), 'created_at' => now(),
            ]);
        });
    }

    private function pauseRemovedSellers(array $removed): array
    {
        if ($removed === []) {
            return [];
        }
        $stored = BitrixRoutingBucket::query()->lockForUpdate()->get()->keyBy('key');
        $definitions = collect(BitrixRoutingConfig::BUCKETS)->map(fn (array $bucket): array => array_map(fn (int $id): array => ['user_id' => $id, 'paused' => false], $bucket['sellers']));
        // Materialize affected defaults, so re-enabling an account cannot silently resume them.
        foreach ($stored as $key => $row) {
            $definitions[$key] = $row->sellers;
        }
        foreach (['santa_fe', 'mutual_paii'] as $key) {
            if (! $stored->has($key) && $stored->has('santa_fe_anses')) {
                $definitions[$key] = $stored['santa_fe_anses']->sellers;
            }
        }
        $paused = [];
        foreach ($definitions as $key => $sellers) {
            $changed = false;
            foreach ($sellers as &$seller) {
                if (in_array((int) $seller['user_id'], $removed, true)) {
                    $seller['paused'] = true;
                    $changed = true;
                }
            }
            unset($seller);
            if ($changed) {
                BitrixRoutingBucket::query()->updateOrCreate(['key' => $key], ['sellers' => $sellers]);
                $paused[] = $key;
            }
        }

        return $paused;
    }
}
