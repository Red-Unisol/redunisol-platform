<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use RuntimeException;

class BitrixUserDirectory
{
    public function __construct(private EdnaBitrix $bitrix) {}

    /** @return array<int, array{name: string, email: string, active: bool}> */
    public function users(bool $fresh = false): array
    {
        $key = 'bitrix-user-directory:'.hash('sha256', (string) config('edna.bitrix_url'));
        if ($fresh) {
            Cache::forget($key);
        }

        return Cache::remember($key, now()->addMinutes(5), function (): array {
            $users = [];
            for ($page = 0; $page < 100; $page++) {
                $rows = $this->bitrix->call('user.get', [
                    'FILTER' => ['USER_TYPE' => 'employee'],
                    'SELECT' => ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'ACTIVE', 'USER_TYPE'],
                    'sort' => 'ID', 'order' => 'ASC', 'start' => $page * 50,
                ]);
                if (! is_array($rows) || ! array_is_list($rows)) {
                    throw new RuntimeException('No se pudo obtener el directorio de Bitrix.');
                }
                foreach ($rows as $row) {
                    if (! is_array($row) || ! ctype_digit((string) ($row['ID'] ?? '')) || (int) $row['ID'] < 1) {
                        throw new RuntimeException('El directorio de Bitrix devolvió una respuesta incompleta.');
                    }
                    if (($row['USER_TYPE'] ?? '') !== 'employee') {
                        continue;
                    }
                    $name = trim(($row['NAME'] ?? '').' '.($row['LAST_NAME'] ?? ''));
                    if ($name === '') {
                        continue;
                    }
                    $users[(int) $row['ID']] = [
                        'name' => $name,
                        'email' => trim((string) ($row['EMAIL'] ?? '')),
                        'active' => in_array($row['ACTIVE'] ?? null, [true, 'Y', 1, '1'], true),
                    ];
                }
                if (count($rows) < 50) {
                    uasort($users, fn (array $a, array $b): int => strnatcasecmp($a['name'], $b['name']) ?: strnatcasecmp($a['email'], $b['email']));

                    return $users;
                }
            }

            throw new RuntimeException('No se pudo completar el directorio de Bitrix.');
        });
    }
}
