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
        8057 => 'Stefania Salguero',
        58913 => 'Ludmila Gallardo',
        127337 => 'Renato Rodriguez Barros',
    ];

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
            'sellers' => [8057],
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
            : self::BUCKETS['santa_fe']['sellers'];

        return $pools;
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
            ->whereIn('key', [...array_keys(self::BUCKETS), 'santa_fe_anses'])
            ->get()
            ->keyBy('key');

        return collect(self::BUCKETS)->map(function (array $definition, string $key) use ($stored): array {
            $row = $stored->get($key);
            if (! $row && in_array($key, ['santa_fe', 'mutual_paii'], true)) {
                $row = $stored->get('santa_fe_anses');
            }
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
