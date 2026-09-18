<?php

namespace App\Console\Commands;

use App\Support\EdnaProbeCapture;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;

class EdnaProbe extends Command
{
    protected $signature = 'edna:probe {action : start, capture, show or stop} {id?} {--subject=2423} {--minutes=240} {--capture-minutes=15} {--payload : Decrypt captured bodies in console output}';

    protected $description = 'Manage an Edna probe with optional temporary encrypted body capture; never store header values';

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
        if (! is_string($id) || ! Str::isUuid($id) || ! in_array($action, ['capture', 'show', 'stop'], true)) {
            $this->error('Use start, capture <UUID>, show <UUID>, or stop <UUID>.');

            return self::FAILURE;
        }
        if ($action === 'stop') {
            Cache::lock('edna-probe-lock:'.$id, 5)->block(2, function () use ($id) {
                Cache::forget('edna-probe:'.$id);
                Cache::forget('edna-probe-result:'.$id);
                Cache::forget('edna-probe-captures:'.$id);
            });
            $this->info('Probe removed.');
        } elseif ($action === 'capture') {
            $minutes = filter_var($this->option('capture-minutes'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 30]]);
            if ($minutes === false) {
                $this->error('Use a capture duration from 1 to 30 minutes.');

                return self::FAILURE;
            }
            $settings = Cache::lock('edna-probe-lock:'.$id, 5)->block(2, function () use ($id, $minutes) {
                $settings = Cache::get('edna-probe:'.$id);
                if (! is_array($settings) || $settings['expires_at'] <= now()->timestamp) {
                    return null;
                }
                $settings['capture_until'] = min($settings['expires_at'], now()->addMinutes($minutes)->timestamp);
                Cache::put('edna-probe:'.$id, $settings, $settings['expires_at'] - now()->timestamp);

                return $settings;
            });
            if ($settings === null) {
                $this->error('Probe is not active.');

                return self::FAILURE;
            }
            $this->line(json_encode(['id' => $id, ...$settings], JSON_THROW_ON_ERROR));
        } else {
            $settings = Cache::get('edna-probe:'.$id);
            $active = is_array($settings) && $settings['expires_at'] > now()->timestamp;
            $captures = $active ? Cache::get('edna-probe-captures:'.$id, []) : [];
            foreach ($captures as &$capture) {
                if ($this->option('payload')) {
                    // Base64 preserves malformed JSON and arbitrary bytes exactly.
                    $capture['body_base64'] = base64_encode(Crypt::decryptString($capture['encrypted_body']));
                }
                unset($capture['encrypted_body']);
            }
            unset($capture);
            $this->line(json_encode([
                'active' => $active,
                'result' => $active ? Cache::get('edna-probe-result:'.$id) : null,
                'capture_active' => $active && ($settings['capture_until'] ?? 0) > now()->timestamp,
                'capture_until' => $active ? ($settings['capture_until'] ?? null) : null,
                'capture_limit_reached' => count($captures) >= EdnaProbeCapture::MAX_EVENTS,
                'captures' => $captures,
            ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        }

        return self::SUCCESS;
    }
}
