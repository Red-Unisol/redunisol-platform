<?php

namespace App\Http\Controllers;

use App\Services\AttributionJourney;
use App\Services\JourneyLedger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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
        if ($request->has('entity')) {
            $input = $request->validate(['entity' => 'required|in:attribution',
                'after' => ['nullable', 'string', 'regex:/^'.AttributionJourney::REFERENCE_PATTERN.'$/D']]);
            // Current reference inventory, including pre-cutover acquisition. Only the volume is read.
            $rows = DB::connection('journey')->table('attribution_journeys')
                ->where('id', '>', $input['after'] ?? '')->orderBy('id')->limit(200)->get();
            $body = '';
            foreach ($rows as $row) {
                $event = $ledger->event('attribution.snapshot', [
                    'snapshot' => (new AttributionJourney)->snapshot($row),
                    'created_at' => $row->created_at, 'updated_at' => $row->updated_at,
                    'bound_at' => $row->bound_at, 'expires_at' => $row->expires_at,
                ], array_filter(['journey_id' => $row->id, 'phone_hash' => $row->recipient_hash, 'subject_id' => $row->subject_id]),
                    'web.server', hash('sha256', 'attribution.snapshot:'.json_encode($row, JSON_THROW_ON_ERROR)), $row->updated_at);
                $body .= json_encode($event, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n";
            }

            return response($body, 200, ['Content-Type' => 'application/x-ndjson; charset=UTF-8',
                'Cache-Control' => 'private, no-store', 'X-Next-Id' => $rows->last()?->id ?? ($input['after'] ?? ''),
                'X-Count' => (string) $rows->count()]);
        }
        if (! $request->has('date')) {
            $files = [];
            foreach (glob($directory.'/events-????-??-??.jsonl') ?: [] as $file) {
                $files[] = ['date' => substr(basename($file), 7, 10), 'bytes' => filesize($file)];
            }
            $stateFile = $directory.'/crm-cursors.json';
            $collection = null;
            $cursorStatus = 'not_started';
            if (is_file($stateFile)) {
                try {
                    $collection = json_decode(file_get_contents($stateFile), true, 32, JSON_THROW_ON_ERROR);
                    $cursorStatus = is_array($collection) ? 'available' : 'unreadable';
                } catch (\Throwable) {
                    $cursorStatus = 'unreadable';
                }
            }

            return response()->json([
                'schema_version' => 1, 'format' => 'application/x-ndjson', 'encoding' => 'UTF-8',
                'environment' => config('journey.environment'), 'generated_at' => now()->toIso8601String(),
                'files' => $files, 'free_bytes' => disk_free_space($directory),
                'reserve_bytes' => config('journey.min_free_bytes'),
                'entities' => ['attribution' => 'GET ?entity=attribution&after=reference_id; 200 current states/page; follow X-Next-Id until X-Count=0. Use event files for incremental history.'],
                'collection' => ['web_enabled' => (bool) config('journey.enabled'),
                    'crm_enabled' => (bool) config('journey.crm_enabled'),
                    'crm_since' => config('journey.crm_since'), 'crm_cursor_status' => $cursorStatus, 'crm_cursors' => $collection],
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
