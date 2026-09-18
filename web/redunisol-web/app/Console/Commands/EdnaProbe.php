<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class EdnaProbe extends Command
{
    protected $signature = 'edna:probe {action : start, show or stop} {id?} {--subject=2423} {--minutes=240}';

    protected $description = 'Manage a temporary Edna header-name probe without storing header values or messages';

    public function handle(): int
    {
        $action = $this->argument('action');
        if ($action === 'start') {
            $minutes = filter_var($this->option('minutes'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 240]]);
            $subject = (string) $this->option('subject');
            if ($minutes === false || ! preg_match('/^[0-9]{1,64}$/D', $subject)) {
                $this->error('Use a numeric subject and a duration from 1 to 240 minutes.');

                return self::FAILURE;
            }
            $id = (string) Str::uuid();
            $settings = [
                'subject_id' => $subject,
                'marker' => 'prueba-edna-'.Str::lower(Str::random(16)),
                'expires_at' => now()->addMinutes($minutes)->timestamp,
            ];
            Cache::put('edna-probe:'.$id, $settings, $minutes * 60);
            $this->line(json_encode([
                'id' => $id, 'path' => '/api/webhooks/edna/probe/'.$id, ...$settings,
            ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));

            return self::SUCCESS;
        }
        $id = $this->argument('id');
        if (! is_string($id) || ! Str::isUuid($id) || ! in_array($action, ['show', 'stop'], true)) {
            $this->error('Use start, show <UUID>, or stop <UUID>.');

            return self::FAILURE;
        }
        if ($action === 'stop') {
            Cache::forget('edna-probe:'.$id);
            Cache::forget('edna-probe-result:'.$id);
            $this->info('Probe removed.');
        } else {
            $this->line(json_encode([
                'active' => Cache::has('edna-probe:'.$id),
                'result' => Cache::get('edna-probe-result:'.$id),
            ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        }

        return self::SUCCESS;
    }
}
