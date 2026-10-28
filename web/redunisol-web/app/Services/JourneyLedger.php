<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use RuntimeException;

/** Append-only, one append per batch. No SQL, database queue or per-event fsync. */
class JourneyLedger
{
    private array $pending = [];

    public const COOKIES = ['ru_visitor', 'ru_session'];

    public const PRIVATE_PATHS = ['admin*', 'api/*', 'dashboard*', 'settings*', 'login', 'register', 'logout',
        'forgot-password', 'reset-password*', 'confirm-password', 'two-factor-challenge', 'user/*', 'email/*', 'sanctum/*', 'health', 'up'];

    public function directory(): string
    {
        $root = rtrim((string) config('journey.root'), '/\\');
        // A marker alone could survive a lost mount. Also require a distinct filesystem.
        if (! is_file($root.'/.redunisol-tracking-volume')
            || (! app()->runningUnitTests() && stat($root)['dev'] === stat(storage_path())['dev'])) {
            throw new RuntimeException('Tracking volume is unavailable.');
        }
        $environment = (string) config('journey.environment');
        if (! preg_match('/^[a-zA-Z0-9_-]{1,40}$/D', $environment)) {
            throw new RuntimeException('Invalid tracking environment.');
        }
        $directory = $root.'/'.$environment;
        if (! is_dir($directory) || ! is_writable($directory)) {
            throw new RuntimeException('Tracking directory is unavailable.');
        }

        return $directory;
    }

    public function context(?Request $request = null): array
    {
        $request ??= request();
        $context = $request->attributes->get('journey_context', []);
        foreach (self::COOKIES as $index => $cookie) {
            $value = $request->cookie($cookie);
            if (is_string($value) && Str::isUuid($value)) {
                $context[$index === 0 ? 'visitor_id' : 'session_id'] ??= $value;
            }
        }
        $ref = $request->attributes->get('journey_reference', $request->cookie(AttributionJourney::COOKIE));
        if (is_string($ref) && preg_match('/^'.AttributionJourney::REFERENCE_PATTERN.'$/D', $ref)) {
            $context['journey_id'] = $ref;
        }

        return $context;
    }

    public function event(string $type, array $data = [], array $links = [], string $source = 'web.server', ?string $id = null, ?string $at = null): array
    {
        return [
            'schema_version' => 1, 'event_id' => $id ?? (string) Str::uuid(),
            'type' => $type, 'source' => $source,
            'environment' => config('journey.environment'),
            'occurred_at' => $at === null ? now()->toISOString() : CarbonImmutable::parse($at)->toISOString(),
            'received_at' => now()->toISOString(),
            'links' => (object) $links, 'data' => (object) $data,
        ];
    }

    public function append(array $events, bool $durable = false): void
    {
        if (! $events) {
            return;
        }
        $directory = $this->directory();
        if (disk_free_space($directory) < config('journey.min_free_bytes')) {
            throw new RuntimeException('Tracking volume reserve reached.');
        }
        $payload = '';
        foreach ($events as $event) {
            $line = json_encode($event, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n";
            if (strlen($line) > 1048576) {
                throw new RuntimeException('Tracking record exceeds the export record limit.');
            }
            $payload .= $line;
        }
        $handle = fopen($directory.'/events-'.gmdate('Y-m-d').'.jsonl', 'c+b');
        if (! $handle) {
            throw new RuntimeException('Tracking journal unavailable.');
        }
        try {
            $deadline = microtime(true) + 0.05;
            while (! flock($handle, LOCK_EX | LOCK_NB)) {
                if (microtime(true) >= $deadline) {
                    throw new RuntimeException('Tracking journal busy.');
                }
                usleep(1000);
            }
            fseek($handle, 0, SEEK_END);
            $start = ftell($handle);
            if ($start > 0) {
                fseek($handle, -1, SEEK_END);
                if (fread($handle, 1) !== "\n") {
                    // A killed writer may leave a partial final line. Recover complete records.
                    $length = min($start, 1048576);
                    fseek($handle, $start - $length);
                    $tail = fread($handle, $length);
                    $last = strrpos($tail, "\n");
                    $start = $last === false ? $start - $length : $start - $length + $last + 1;
                    ftruncate($handle, $start);
                    logger()->warning('Recovered an incomplete tracking journal tail.');
                }
                fseek($handle, 0, SEEK_END);
            }
            $offset = 0;
            try {
                while ($offset < strlen($payload)) {
                    $written = fwrite($handle, substr($payload, $offset));
                    if (! $written) {
                        throw new RuntimeException('Tracking append failed.');
                    }
                    $offset += $written;
                }
                if (! fflush($handle)) {
                    throw new RuntimeException('Tracking flush failed.');
                }
                if ($durable && ! fsync($handle)) {
                    throw new RuntimeException('Tracking durable flush failed.');
                }
                if ($durable && PHP_OS_FAMILY === 'Linux') {
                    $parent = fopen($directory, 'r');
                    try {
                        if (! $parent || ! fsync($parent)) {
                            throw new RuntimeException('Tracking directory flush failed.');
                        }
                    } finally {
                        if ($parent) {
                            fclose($parent);
                        }
                    }
                }
            } catch (\Throwable $error) {
                ftruncate($handle, $start);
                throw $error;
            }
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    /** Business operations fail open; the public batch endpoint returns 503 for retry. */
    public function record(string $type, array $data = [], array $links = [], string $source = 'web.server', ?string $id = null): void
    {
        if (! config('journey.enabled')) {
            return;
        }
        try {
            $this->pending[] = $this->event($type, $data, $links ?: $this->context(), $source, $id);
            if (count($this->pending) >= 100) {
                $this->flush();
            }
        } catch (\Throwable) {
            logger()->warning('Journey event could not be persisted.', ['type' => $type]);
        }
    }

    public function flush(): void
    {
        $events = $this->pending;
        $this->pending = [];
        try {
            $this->append($events);
        } catch (\Throwable) {
            logger()->warning('Journey batch could not be persisted.', ['events' => count($events)]);
        }
    }

    public static function url(string $url): string
    {
        if ($url === '') {
            return '';
        }
        $parts = parse_url($url);
        if (! is_array($parts) || ! in_array($parts['scheme'] ?? '', ['https', 'http'], true) || empty($parts['host'])) {
            return '';
        }
        if (Str::is(self::PRIVATE_PATHS, ltrim($parts['path'] ?? '', '/'))) {
            return '';
        }
        parse_str($parts['query'] ?? '', $query);
        $keys = [...AttributionJourney::CLICK_IDS, 'msclkid', 'ttclid', 'dclid', 'li_fat_id', 'sccid', 'twclid', 'yclid', 'irclickid', 'epik', 'gad_source', 'gad_campaignid', 'srsltid', '_gl', 'ref'];
        $query = array_filter($query, fn ($value, $key) => is_string($value) && strlen($key) <= 80
            && (str_starts_with($key, 'utm_') || in_array($key, $keys, true)), ARRAY_FILTER_USE_BOTH);
        $query = array_map(fn ($value) => Str::limit($value, 512, ''), $query);

        return Str::limit(($parts['scheme'] ?? 'https').'://'.($parts['host'] ?? '').($parts['path'] ?? '/')
            .($query ? '?'.http_build_query($query) : ''), 4096, '');
    }
}
