<?php

namespace App\Http\Controllers;

use App\Services\JourneyLedger;
use Illuminate\Http\Request;

class JourneyExportController
{
    public function __invoke(Request $request, JourneyLedger $ledger)
    {
        $token = (string) config('journey.export_token');
        abort_unless($token !== '' && hash_equals($token, (string) $request->bearerToken()), 403);
        if ($request->boolean('schema')) {
            return response()->json(json_decode(file_get_contents(base_path('docs/journey-data.schema.json')), true, 32, JSON_THROW_ON_ERROR))
                ->header('Cache-Control', 'private, no-store');
        }
        try {
            $directory = $ledger->directory();
        } catch (\Throwable) {
            abort(503);
        }
        if (! $request->has('date')) {
            $files = [];
            foreach (glob($directory.'/events-????-??-??.jsonl') ?: [] as $file) {
                $files[] = ['date' => substr(basename($file), 7, 10), 'bytes' => filesize($file)];
            }

            return response()->json([
                'schema_version' => 1, 'format' => 'application/x-ndjson', 'encoding' => 'UTF-8',
                'environment' => config('journey.environment'), 'generated_at' => now()->toIso8601String(),
                'files' => $files, 'free_bytes' => disk_free_space($directory),
                'reserve_bytes' => config('journey.min_free_bytes'),
                'deduplicate_by' => 'event_id', 'order_by' => ['occurred_at', 'received_at', 'event_id'],
                'envelope' => ['schema_version', 'event_id', 'type', 'source', 'environment', 'occurred_at', 'received_at', 'links', 'data'],
                'identity' => ['visitor_id' => 'browser, 30 days', 'session_id' => 'browser, 30 minutes inactivity',
                    'journey_id' => 'immutable acquisition/WhatsApp reference; multiple per visitor',
                    'phone_hash' => 'HMAC normalized Argentine phone; app-key dependent',
                    'submission_id' => 'server-generated form attempt', 'lead_id' => 'Bitrix lead',
                    'contact_id' => 'Bitrix contact', 'deal_id' => 'Bitrix deal'],
                'cursor' => 'GET ?date=YYYY-MM-DD&offset=byte_offset; follow X-Next-Offset; revisit today until it closes',
                'delivery' => 'At least once on acknowledged retries. Browser and power-loss gaps remain possible. No inferred identities.',
            ])->header('Cache-Control', 'private, no-store');
        }
        $input = $request->validate(['date' => 'required|date_format:Y-m-d', 'offset' => 'nullable|integer|min:0']);
        $file = $directory.'/events-'.$input['date'].'.jsonl';
        abort_unless(is_file($file), 404);
        $offset = (int) ($input['offset'] ?? 0);
        $handle = fopen($file, 'rb');
        abort_unless($handle, 503);
        try {
            abort_unless(flock($handle, LOCK_SH | LOCK_NB), 503);
            $size = fstat($handle)['size'];
            abort_if($offset > $size, 416);
            if ($offset > 0) {
                fseek($handle, $offset - 1);
                abort_unless(fread($handle, 1) === "\n", 416);
            }
            fseek($handle, $offset);
            $body = fread($handle, 4 * 1024 * 1024);
            $last = strrpos($body, "\n");
            $body = $last === false ? '' : substr($body, 0, $last + 1);
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }

        return response($body, 200, ['Content-Type' => 'application/x-ndjson; charset=UTF-8',
            'Cache-Control' => 'private, no-store', 'X-Next-Offset' => (string) ($offset + strlen($body)),
            'X-Snapshot-Bytes' => (string) $size]);
    }
}
