<?php

namespace App\Support;

use App\Models\BitrixRoutingBucket;
use App\Models\BitrixRoutingSeller;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class BitrixRoutingConfig
{
    public const BUCKETS = [
        'santa_fe' => [
            'label' => 'Santa Fe',
            'description' => 'Haberes Premium de Santa Fe. Jubilados nacionales se distribuyen por Mutual PAII.',
            'sellers' => [10451, 29, 116561],
        ],
        'mutual_paii' => [
            'label' => 'Mutual PAII',
            'description' => 'Red Mutual - paii: ANSES de cualquier provincia y perfiles habilitados de Buenos Aires.',
            'sellers' => [10451, 29, 116561],
        ],
        'neuquen' => [
            'label' => 'Neuquén',
            'description' => 'MUDON de Neuquén, con Ludmila Gallardo.',
            'sellers' => [58913],
        ],
        'policia_federal_caba' => [
            'label' => 'CABA — Policía Federal',
            'description' => 'Policía Federal residente en CABA, desde el 14/09/2026.',
            'sellers' => [],
        ],
        'catamarca_general' => [
            'label' => 'Catamarca — General',
            'description' => 'Negociaciones internas de Catamarca.',
            'sellers' => [68579, 10451, 29, 90231, 71159, 113457, 113455, 116561, 110059],
        ],
        'cordoba_jubilados' => [
            'label' => 'Córdoba — Jubilados y pensionados',
            'description' => 'Jubilados provinciales, municipales y pensionados. Jubilado Nacional se distribuye por ANSES.',
            'sellers' => [10451, 71159, 68579, 90231, 29, 110059, 116561],
        ],
        'cordoba_unc' => [
            'label' => 'Córdoba — UNC y DASPU',
            'description' => 'Empleados de la UNC y afiliados de DASPU.',
            'sellers' => [53121],
        ],
        'cordoba_general' => [
            'label' => 'Córdoba — General',
            'description' => 'Resto de las situaciones laborales habilitadas en Córdoba.',
            'sellers' => [10451, 71159, 68579, 90231, 29, 116561, 110059],
        ],
    ];

    public function forForm(): array
    {
        return $this->buckets()
            ->mapWithKeys(fn (array $bucket, string $key): array => [$key => $bucket['sellers']])
            ->all();
    }

    public function activePools(): array
    {
        $pools = $this->buckets()
            ->map(fn (array $bucket): array => collect($bucket['sellers'])
                ->reject(fn (array $seller): bool => $seller['paused'])
                ->pluck('user_id')
                ->values()
                ->all())
            ->all();

        // Keep the previous contract during the independent web/Kestra rollouts.
        $legacy = BitrixRoutingBucket::query()->find('santa_fe_anses');
        $pools['santa_fe_anses'] = $legacy
            ? collect($this->normalizeSellers($legacy->sellers))
                ->reject(fn (array $seller): bool => $seller['paused'])
                ->pluck('user_id')->values()->all()
            : array_column($this->normalizeSellers(array_map(fn (int $id): array => ['user_id' => $id, 'paused' => false], self::BUCKETS['santa_fe']['sellers'])), 'user_id');

        return $pools;
    }

    public function save(array $state, ?int $catalogRevision = null): void
    {
        DB::transaction(function () use ($state, $catalogRevision): void {
            app(BitrixSellerRegistry::class)->lock($catalogRevision);
            $enabled = self::sellerOptions();
            foreach (array_keys(self::BUCKETS) as $key) {
                if (! array_key_exists($key, $state)) {
                    continue;
                }

                $seen = [];
                $sellers = collect($state[$key])
                    ->map(function (array $seller) use (&$seen, $enabled): ?array {
                        $userId = (int) ($seller['user_id'] ?? 0);

                        if (! isset($enabled[$userId]) || isset($seen[$userId])) {
                            return null;
                        }

                        $seen[$userId] = true;

                        return [
                            'user_id' => $userId,
                            'paused' => (bool) ($seller['paused'] ?? false),
                        ];
                    })
                    ->filter()
                    ->values()
                    ->all();

                BitrixRoutingBucket::query()->updateOrCreate(
                    ['key' => $key],
                    ['sellers' => $sellers],
                );
            }
        });
    }

    public static function sellerOptions(): array
    {
        return BitrixRoutingSeller::query()->where('enabled', true)->orderBy('name')->get()
            ->mapWithKeys(fn (BitrixRoutingSeller $seller): array => [$seller->bitrix_user_id => $seller->label()])->all();
    }

    private function buckets(): Collection
    {
        $enabled = self::sellerOptions();
        $stored = BitrixRoutingBucket::query()
            ->whereIn('key', [...array_keys(self::BUCKETS), 'santa_fe_anses'])
            ->get()
            ->keyBy('key');

        return collect(self::BUCKETS)->map(function (array $definition, string $key) use ($stored, $enabled): array {
            $row = $stored->get($key);
            if (! $row && in_array($key, ['santa_fe', 'mutual_paii'], true)) {
                $row = $stored->get('santa_fe_anses');
            }
            $sellers = $row
                ? $this->normalizeSellers($row->sellers, $enabled)
                : $this->normalizeSellers(array_map(fn (int $id): array => ['user_id' => $id, 'paused' => false], $definition['sellers']), $enabled);

            return [
                ...$definition,
                'sellers' => $sellers,
            ];
        });
    }

    private function normalizeSellers(array $sellers, ?array $enabled = null): array
    {
        $enabled ??= self::sellerOptions();

        return collect($sellers)
            ->filter(fn (array $seller): bool => isset($enabled[(int) $seller['user_id']]))
            ->map(fn (array $seller): array => [
                'user_id' => (int) $seller['user_id'],
                'paused' => (bool) ($seller['paused'] ?? false),
            ])
            ->values()
            ->all();
    }
}
