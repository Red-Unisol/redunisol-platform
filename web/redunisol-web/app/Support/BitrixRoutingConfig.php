<?php

namespace App\Support;

use App\Models\BitrixRoutingBucket;
use Illuminate\Support\Collection;

class BitrixRoutingConfig
{
    public const SELLERS = [
        68579 => 'Daniel Carrera',
        10451 => 'Patricia Contendi',
        29 => 'Susana Contenti',
        90231 => 'Soledad Rojo Moyano',
        71159 => 'Natalia Rojo Moyano',
        113457 => 'Claudia Algarbe',
        113455 => 'Daniela Arias',
        116561 => 'Julieta Aguilera',
        110059 => 'Agustín Villagra',
        53121 => 'Gloria Fernandez',
    ];

    public const BUCKETS = [
        'catamarca_general' => [
            'label' => 'Catamarca — General',
            'description' => 'Negociaciones internas de Catamarca.',
            'sellers' => [68579, 10451, 29, 90231, 71159, 113457, 113455, 116561, 110059],
        ],
        'cordoba_jubilados' => [
            'label' => 'Córdoba — Jubilados y pensionados',
            'description' => 'Jubilados provinciales, nacionales, municipales y pensionados.',
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
        return $this->buckets()
            ->map(fn (array $bucket): array => collect($bucket['sellers'])
                ->reject(fn (array $seller): bool => $seller['paused'])
                ->pluck('user_id')
                ->values()
                ->all())
            ->all();
    }

    public function save(array $state): void
    {
        foreach (array_keys(self::BUCKETS) as $key) {
            if (! array_key_exists($key, $state)) {
                continue;
            }

            $seen = [];
            $sellers = collect($state[$key])
                ->map(function (array $seller) use (&$seen): ?array {
                    $userId = (int) ($seller['user_id'] ?? 0);

                    if (! isset(self::SELLERS[$userId]) || isset($seen[$userId])) {
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
    }

    public static function sellerOptions(): array
    {
        return self::SELLERS;
    }

    private function buckets(): Collection
    {
        $stored = BitrixRoutingBucket::query()
            ->whereIn('key', array_keys(self::BUCKETS))
            ->get()
            ->keyBy('key');

        return collect(self::BUCKETS)->map(function (array $definition, string $key) use ($stored): array {
            $row = $stored->get($key);
            $sellers = $row
                ? $this->normalizeSellers($row->sellers)
                : collect($definition['sellers'])
                    ->map(fn (int $userId): array => ['user_id' => $userId, 'paused' => false])
                    ->all();

            return [
                ...$definition,
                'sellers' => $sellers,
            ];
        });
    }

    private function normalizeSellers(array $sellers): array
    {
        return collect($sellers)
            ->map(fn (array $seller): array => [
                'user_id' => (int) $seller['user_id'],
                'paused' => (bool) ($seller['paused'] ?? false),
            ])
            ->values()
            ->all();
    }
}
