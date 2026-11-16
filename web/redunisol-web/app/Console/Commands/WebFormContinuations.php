<?php

namespace App\Console\Commands;

use App\Services\AttributionJourney;
use App\Services\WebFormContinuation;
use App\Services\WebFormReceipt;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class WebFormContinuations extends Command
{
    protected $signature = 'edna:web-forms {action=status : status, import or reconcile}
        {--date=* : UTC journal dates to import, YYYY-MM-DD; maximum 3}
        {--request=* : Audited intake request IDs to reconcile; maximum 100}
        {--confirmed-crm-continuity : Operator verified the existing CRM leads and their management}
        {--apply : Apply the preview; ready reconciliation can enqueue guarded CRM linking}';

    protected $description = 'Inspect web continuations and settle proven redundant responses without sending forms';

    public function handle(): int
    {
        try {
            $result = match ($this->argument('action')) {
                'status' => ['receipts' => DB::table('web_form_receipts')->selectRaw('state, count(*) as total')->groupBy('state')->get(),
                    'continuations' => DB::table('web_form_continuations')->orderByDesc('entry_event_id')->limit(50)
                        ->get(['entry_event_id', 'submission_id', 'state', 'reason', 'lead_id', 'proof_source'])],
                'import' => $this->import(),
                'reconcile' => $this->reconcile(),
                default => throw new RuntimeException('Unknown action.'),
            };
            $this->line(json_encode($result, JSON_THROW_ON_ERROR));

            return self::SUCCESS;
        } catch (Throwable) {
            // Journal input contains personal data; never print the exception or its source.
            $this->error('Web form operation failed. Verify action, bounds and evidence; no automatic retry.');

            return self::FAILURE;
        }
    }

    private function import(): array
    {
        $dates = array_values(array_unique($this->option('date')));
        if (! $dates || count($dates) > 3) {
            throw new RuntimeException('Explicit bounded dates required.');
        }
        $forms = [];
        foreach ($dates as $date) {
            if (! preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date)
                || CarbonImmutable::parse($date)->lt(now()->subDays(30)->startOfDay()) || $date > gmdate('Y-m-d')) {
                throw new RuntimeException('Journal date outside retention.');
            }
            $environment = (string) config('journey.environment');
            if (! preg_match('/^[A-Za-z0-9_-]{1,40}$/D', $environment)) {
                throw new RuntimeException('Invalid environment.');
            }
            $file = rtrim((string) config('journey.root'), '/').'/'.$environment.'/events-'.$date.'.jsonl';
            if (! is_file($file) || filesize($file) > 134217728) {
                throw new RuntimeException('Journal unavailable or oversized.');
            }
            $handle = fopen($file, 'rb');
            try {
                $lines = 0;
                while (($line = fgets($handle, 1048578)) !== false) {
                    if (++$lines > 250000 || strlen($line) > 1048576) {
                        throw new RuntimeException('Journal bound exceeded.');
                    }
                    $event = json_decode($line, true, 64);
                    if (! is_array($event) || ! in_array($event['type'] ?? '', ['form.received', 'form.persistence_result', 'form.queue_failed'], true)) {
                        continue;
                    }
                    $id = $event['links']['submission_id'] ?? '';
                    if (! Str::isUuid($id)) {
                        continue;
                    }
                    $forms[$id][] = $event;
                }
            } finally {
                fclose($handle);
            }
        }
        $eligible = 0;
        $applied = 0;
        foreach ($forms as $id => $events) {
            $received = collect($events)->firstWhere('type', 'form.received');
            $input = $received['data']['input'] ?? [];
            $hash = (new AttributionJourney)->phoneHash((string) ($input['celular'] ?? ''));
            if (! $hash || ! hash_equals($hash, (string) ($received['links']['phone_hash'] ?? ''))
                || DB::table('web_form_receipts')->where('id', $id)->exists()) {
                continue;
            }
            $at = CarbonImmutable::parse($received['occurred_at']);
            $row = ['id' => $id, 'phone_hash' => $hash, 'identity_hash' => app(WebFormReceipt::class)->identityHash((string) ($input['cuil'] ?? '')),
                'journey_id' => $received['links']['journey_id'] ?? null, 'received_at' => $at, 'expires_at' => $at->addDay(),
                'state' => 'uncertain', 'source' => 'tracking_import', 'created_at' => now(), 'updated_at' => now()];
            $successfulLeads = [];
            foreach ($events as $event) {
                if (! hash_equals($hash, (string) ($event['links']['phone_hash'] ?? ''))) {
                    throw new RuntimeException('Journal identity conflict.');
                }
                $body = $event['data']['result'] ?? [];
                $lead = (string) ($event['links']['lead_id'] ?? '');
                if ($event['type'] === 'form.persistence_result' && ($body['ok'] ?? false) === true
                    && preg_match('/^[1-9][0-9]{0,63}$/D', $lead) && $lead === (string) ($body['lead_id'] ?? '')
                    && CarbonImmutable::parse($event['occurred_at'])->gte($at)) {
                    $successfulLeads[$lead] = true;
                    $row += ['lead_id' => $lead, 'contact_id' => $event['links']['contact_id'] ?? null,
                        'persisted_at' => CarbonImmutable::parse($event['occurred_at'])];
                    $row['state'] = 'synced';
                } elseif ($event['type'] === 'form.queue_failed' && $row['state'] !== 'synced') {
                    $row['state'] = 'failed';
                }
            }
            if (count($successfulLeads) > 1) {
                $row['state'] = 'uncertain';
                $row['lead_id'] = $row['contact_id'] = $row['persisted_at'] = null;
            }
            $eligible++;
            if ($this->option('apply')) {
                $applied += app(WebFormReceipt::class)->serialized($hash, fn () => DB::table('web_form_receipts')->insertOrIgnore($row));
            }
        }

        return ['eligible' => $eligible, 'imported' => $applied, 'writes_crm' => 0, 'messages_sent' => 0];
    }

    private function reconcile(): array
    {
        $ids = array_values(array_unique($this->option('request')));
        if (count($ids) > 100 || collect($ids)->contains(fn ($id) => ! ctype_digit((string) $id) || (int) $id < 1)
            || ($this->option('apply') && (! $ids || ! $this->option('confirmed-crm-continuity')))) {
            throw new RuntimeException('Explicit requests and verified CRM continuity required.');
        }
        if (! $ids) {
            $ids = DB::table('edna_intake_requests')->where('state', 'review')
                ->whereIn('reason', ['bound_management_requires_review', 'bound_profile_conflict'])
                ->orderBy('id')->limit(100)->pluck('id')->all();
        }
        $eligible = [];
        foreach ($ids as $id) {
            $result = app(WebFormContinuation::class)->settleRedundant((int) $id, (bool) $this->option('apply'));
            if ($result) {
                $eligible[] = $result;
            }
        }

        return ['eligible' => $eligible, 'applied' => (bool) $this->option('apply'), 'writes_crm' => 0, 'messages_sent' => 0];
    }
}
