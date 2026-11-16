<?php

namespace App\Console\Commands;

use App\Jobs\LinkWebFormChat;
use App\Jobs\ProcessEdnaOrganicMenu;
use App\Jobs\ReceiveEdnaInKestra;
use App\Services\EdnaWorkQueue;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Throwable;

/** Explicit, preview-bound maintenance of local recovery work; never executes a job. */
class EdnaWorkQueueCommand extends Command
{
    protected $signature = 'edna:work-queue {action=preview : preview/apply, review-preview/review-apply, prioritize-preview/prioritize-apply}
        {--cutoff= : Maximum jobs.id (or menu id for review actions) from the preview}
        {--preview-sha= : Exact SHA-256 returned by the matching preview}';

    protected $description = 'Preview or explicitly apply conservative Edna recovery queue maintenance';

    private const JOBS = [LinkWebFormChat::class => 'entryEventId', ProcessEdnaOrganicMenu::class => 'menuId'];

    private const PRIORITY_JOBS = [LinkWebFormChat::class => 'entryEventId', ReceiveEdnaInKestra::class => 'eventId'];

    private const PRIORITY_QUEUES = [LinkWebFormChat::class => 'edna-web-reconcile', ReceiveEdnaInKestra::class => 'edna-inbox'];

    private const REVIEW_REASONS = ['native_message_pending', 'provider_reads_pending'];

    private const REVIEW_EMPTY = ['proof', 'chat_id', 'session_id', 'lease_token', 'lease_until', 'send_reason', 'send_started_at',
        'accepted_at', 'confirmed_at', 'outgoing_message_id', 'choice_event_id', 'choice', 'choice_received_at',
        'canonical_menu_id', 'flow_send_id', 'case_id', 'deal_id', 'seller_id', 'profile_snapshot', 'profile_evidence', 'transfer_intent'];

    public function handle(EdnaWorkQueue $work): int
    {
        try {
            $action = $this->argument('action');
            $this->require(in_array($action, ['preview', 'apply', 'review-preview', 'review-apply', 'prioritize-preview', 'prioritize-apply'], true), 'invalid_action');
            $review = str_starts_with($action, 'review-');
            $priority = str_starts_with($action, 'prioritize-');
            $apply = in_array($action, ['apply', 'review-apply', 'prioritize-apply'], true);
            $this->require(config('queue.connections.edna.driver') === 'database'
                && config('queue.connections.edna.table') === 'jobs'
                && in_array(config('queue.connections.edna.connection'), [null, config('database.default')], true), 'unsupported_queue_connection');
            $rawCutoff = $this->option('cutoff');
            $this->require(! $apply || $rawCutoff !== null, 'apply_requires_preview_cutoff');
            $cutoff = $rawCutoff === null ? (int) DB::table($review ? 'edna_organic_menus' : 'jobs')->max('id')
                : filter_var($rawCutoff, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
            $this->require($cutoff !== false, 'invalid_cutoff');
            $expected = $this->option('preview-sha');
            $this->require(! $apply || (is_string($expected) && preg_match('/^[a-f0-9]{64}$/D', $expected)), 'apply_requires_preview_sha');
            $result = DB::transaction(function () use ($work, $review, $priority, $apply, $cutoff, $expected): array {
                if (! $apply && DB::getDriverName() === 'pgsql') {
                    DB::statement('SET TRANSACTION READ ONLY');
                }
                $plan = $priority ? $this->priorityPlan($work, $cutoff, $apply)
                    : ($review ? $this->reviewPlan($cutoff, $apply) : $this->queuePlan($work, $cutoff, $apply));
                $sha = hash('sha256', json_encode($plan, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
                if (! $apply) {
                    return ['mode' => 'preview', 'preview_sha' => $sha, 'plan' => $plan];
                }
                $this->require(hash_equals($expected, $sha), 'preview_changed_rerun_preview');
                $this->require(Schema::hasTable('edna_work_queue_keys'), 'work_queue_migration_required');
                if ($priority) {
                    $this->require($plan['counts']['link_hold_conflicts'] === 0, 'reservation_conflict_requires_review');
                    $moved = ['edna-inbox' => 0, 'edna-web-reconcile' => 0];
                    foreach ($plan['moves'] as $item) {
                        $row = DB::table('jobs')->where('id', $item['id'])->lockForUpdate()->first();
                        $this->require($row && $this->priorityRowMatches($row, $item), 'priority_row_changed_rerun_preview');
                        if ($item['job_class'] === LinkWebFormChat::class) {
                            $hold = DB::table('edna_work_queue_keys')->where('key', $item['hold_key'])->lockForUpdate()->first();
                            $this->require($hold && hash_equals($item['hold_sha256'], hash('sha256', json_encode($hold, JSON_THROW_ON_ERROR))),
                                'priority_hold_changed_rerun_preview');
                        }
                        $changed = DB::table('jobs')->where('id', $item['id'])->where('id', '<=', $cutoff)
                            ->where('queue', 'edna')->whereNull('reserved_at')->where('attempts', 0)
                            ->update(['queue' => $item['destination_queue']]);
                        $this->require($changed === 1, 'priority_row_changed_rerun_preview');
                        $moved[$item['destination_queue']]++;
                    }

                    return ['mode' => 'applied', 'preview_sha' => $sha, 'plan' => $plan,
                        'moved' => array_sum($moved), 'moved_by_queue' => $moved];
                }
                if ($review) {
                    foreach ($plan['menus'] as $item) {
                        $updated = $this->reviewQuery($cutoff)->where('id', $item['id'])->update([
                            'state' => 'pending', 'reason' => null, 'available_at' => now(),
                            'enqueued_at' => null, 'updated_at' => now(),
                        ]);
                        $this->require($updated === 1, 'review_row_changed_rerun_preview');
                    }

                    return ['mode' => 'applied', 'preview_sha' => $sha, 'plan' => $plan, 'reset' => count($plan['menus'])];
                }
                $this->require($plan['counts']['reservation_conflicts'] === 0, 'reservation_conflict_requires_review');
                $deleted = 0;
                foreach ($plan['groups'] as $group) {
                    // queuePlan locked and hashed these exact rows in this transaction.
                    // The DELETE repeats the mutable eligibility predicates; no payload
                    // is used in SQL bindings, output, or exception reporting.
                    foreach (array_chunk(array_column($group['delete'], 'id'), 400) as $ids) {
                        $count = DB::table('jobs')->where('queue', 'edna')->whereNull('reserved_at')->where('attempts', 0)
                            ->where('id', '<=', $cutoff)->whereIn('id', $ids)->delete();
                        $this->require($count === count($ids), 'queue_row_changed_rerun_preview');
                        $deleted += $count;
                    }
                    $class = $group['job_class'];
                    $work->adopt(new $class($group['work_id']), $group['keep']['id']);
                }

                return ['mode' => 'applied', 'preview_sha' => $sha, 'plan' => $plan,
                    'deleted' => $deleted, 'adopted' => count($plan['groups'])];
            }, 1);
            $this->line(json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));

            return self::SUCCESS;
        } catch (Throwable $error) {
            // Database/provider exceptions may contain bindings; expose only our codes.
            $codes = ['invalid_action', 'unsupported_queue_connection', 'apply_requires_preview_cutoff', 'invalid_cutoff',
                'apply_requires_preview_sha', 'preview_changed_rerun_preview', 'work_queue_migration_required',
                'review_row_changed_rerun_preview', 'reservation_conflict_requires_review', 'queue_row_changed_rerun_preview',
                'priority_row_changed_rerun_preview', 'priority_hold_changed_rerun_preview'];
            $reason = $error instanceof RuntimeException && in_array($error->getMessage(), $codes, true)
                ? $error->getMessage() : 'work_queue_operation_failed';
            $this->line(json_encode(['mode' => 'failed', 'reason' => $reason], JSON_THROW_ON_ERROR));

            return self::FAILURE;
        }
    }

    private function queuePlan(EdnaWorkQueue $work, int $cutoff, bool $lock): array
    {
        $groups = [];
        $total = 0;
        $canonical = 0;
        $query = DB::table('jobs')->where('queue', 'edna')->where('id', '<=', $cutoff)->orderBy('id');
        $query->chunkById(500, function ($rows) use (&$groups, &$total, &$canonical, $work, $lock): void {
            $candidates = [];
            foreach ($rows as $row) {
                $total++;
                if ($row->reserved_at !== null || (int) $row->attempts !== 0 || ! ($job = $this->canonicalJob($row->payload))) {
                    continue;
                }
                $candidates[(int) $row->id] = [$row, $job];
            }
            $locked = $lock && $candidates ? DB::table('jobs')->whereIn('id', array_keys($candidates))
                ->orderBy('id')->lockForUpdate()->get()->keyBy('id') : null;
            foreach ($candidates as [$row, $job]) {
                if ($lock) {
                    $current = $locked->get($row->id);
                    $this->require($current && $current->queue === 'edna' && $current->reserved_at === null
                        && (int) $current->attempts === 0 && hash_equals(hash('sha256', $row->payload), hash('sha256', $current->payload))
                        && (int) $current->created_at === (int) $row->created_at
                        && (int) $current->available_at === (int) $row->available_at, 'queue_row_changed_rerun_preview');
                }
                $identity = $work->identity($job);
                $key = $identity['key'];
                $snapshot = ['id' => (int) $row->id, 'payload_sha256' => hash('sha256', $row->payload),
                    'created_at' => (int) $row->created_at, 'available_at' => (int) $row->available_at];
                if (! isset($groups[$key])) {
                    $groups[$key] = $identity + ['keep' => $snapshot, 'delete' => [], 'reservation_job_id' => null];
                } else {
                    $groups[$key]['delete'][] = $snapshot;
                }
                $canonical++;
            }
        });
        $conflicts = 0;
        $table = Schema::hasTable('edna_work_queue_keys');
        if ($table) {
            foreach (array_chunk(array_keys($groups), 400) as $keys) {
                $holds = DB::table('edna_work_queue_keys')->whereIn('key', $keys)->orderBy('key');
                if ($lock) {
                    $holds->lockForUpdate();
                }
                foreach ($holds->get() as $hold) {
                    $group = &$groups[$hold->key];
                    $group['reservation_job_id'] = $hold->queue_job_id === null ? null : (int) $hold->queue_job_id;
                    $members = [$group['keep']['id'], ...array_column($group['delete'], 'id')];
                    if ($hold->job_class !== $group['job_class'] || (int) $hold->work_id !== $group['work_id']
                        || ! hash_equals($group['command_sha256'], $hold->command_sha256)
                        || ! in_array((int) $hold->queue_job_id, $members, true)) {
                        $conflicts++;
                    } elseif ((int) $hold->queue_job_id !== $group['keep']['id']) {
                        // A post-deploy dispatcher may already own a newer physical
                        // row. Preserve that exact mapping rather than replacing it.
                        $all = [$group['keep'], ...$group['delete']];
                        $group['keep'] = array_values(array_filter($all, fn ($item) => $item['id'] === (int) $hold->queue_job_id))[0];
                        $group['delete'] = array_values(array_filter($all, fn ($item) => $item['id'] !== (int) $hold->queue_job_id));
                        usort($group['delete'], fn ($a, $b) => $a['id'] <=> $b['id']);
                    }
                    unset($group);
                }
            }
        }

        return ['version' => 1, 'action' => 'deduplicate', 'queue' => 'edna', 'cutoff_kind' => 'jobs.id', 'cutoff' => $cutoff,
            'reservation_table_present' => $table,
            'counts' => ['queue_jobs' => $total, 'canonical_unreserved_jobs' => $canonical,
                'preserved_other_jobs' => $total - $canonical, 'keepers' => count($groups),
                'duplicates' => $canonical - count($groups), 'reservation_conflicts' => $conflicts],
            'groups' => array_values($groups)];
    }

    private function canonicalJob(string $payload, array $supported = self::JOBS): ?object
    {
        try {
            $data = json_decode($payload, true, 16, JSON_THROW_ON_ERROR);
            $class = $data['displayName'] ?? null;
            if (! isset($supported[$class]) || ($data['job'] ?? '') !== 'Illuminate\\Queue\\CallQueuedHandler@call'
                || ($data['data']['commandName'] ?? null) !== $class || ! is_string($data['data']['command'] ?? null)) {
                return null;
            }
            $command = $data['data']['command'];
            $property = $supported[$class];
            $placeholder = 's:'.strlen($property).':"'.$property.'";i:1;';
            $template = serialize(new $class(1));
            if (substr_count($template, $placeholder) !== 1) {
                return null;
            }
            [$before, $after] = explode($placeholder, $template, 2);
            $pattern = '/\\A'.preg_quote($before, '/').preg_quote('s:'.strlen($property).':"'.$property.'";i:', '/')
                .'([1-9][0-9]{0,17});'.preg_quote($after, '/').'\\z/sD';
            if (! preg_match($pattern, $command, $match)) {
                return null;
            }
            $job = new $class((int) $match[1]);

            return serialize($job) === $command ? $job : null;
        } catch (Throwable) {
            return null;
        }
    }

    private function priorityRowMatches(object $row, array $snapshot): bool
    {
        return $row->queue === 'edna' && $row->reserved_at === null && (int) $row->attempts === 0
            && hash_equals($snapshot['payload_sha256'], hash('sha256', $row->payload))
            && (int) $row->created_at === $snapshot['created_at'] && (int) $row->available_at === $snapshot['available_at'];
    }

    private function priorityPlan(EdnaWorkQueue $work, int $cutoff, bool $lock): array
    {
        $table = Schema::hasTable('edna_work_queue_keys');
        $counts = ['queue_jobs' => 0, 'eligible_receive' => 0, 'eligible_link' => 0, 'preserved_other' => 0,
            'reserved_or_attempted' => 0, 'unsupported_or_noncanonical' => 0, 'link_without_hold' => 0,
            'link_invalid_hold' => 0, 'link_hold_conflicts' => 0];
        $moves = [];
        DB::table('jobs')->where('queue', 'edna')->where('id', '<=', $cutoff)->orderBy('id')
            ->chunkById(500, function ($rows) use ($work, $lock, $table, &$counts, &$moves): void {
                $candidates = [];
                $keys = [];
                $linkIds = [];
                foreach ($rows as $row) {
                    $counts['queue_jobs']++;
                    if ($row->reserved_at !== null || (int) $row->attempts !== 0) {
                        $counts['reserved_or_attempted']++;

                        continue;
                    }
                    $job = $this->canonicalJob($row->payload, self::PRIORITY_JOBS);
                    if (! $job) {
                        $counts['unsupported_or_noncanonical']++;

                        continue;
                    }
                    $identity = $job instanceof LinkWebFormChat ? $work->identity($job) : null;
                    $candidates[(int) $row->id] = [$row, $job, $identity];
                    if ($identity !== null) {
                        $keys[] = $identity['key'];
                        $linkIds[] = (int) $row->id;
                    }
                }
                $locked = $lock && $candidates ? DB::table('jobs')->whereIn('id', array_keys($candidates))
                    ->orderBy('id')->lockForUpdate()->get()->keyBy('id') : null;
                $byKey = $byJob = [];
                if ($table && $linkIds) {
                    $holds = DB::table('edna_work_queue_keys')->where(fn ($q) => $q->whereIn('key', $keys)->orWhereIn('queue_job_id', $linkIds))->orderBy('key');
                    if ($lock) {
                        $holds->lockForUpdate();
                    }
                    foreach ($holds->get() as $hold) {
                        $byKey[$hold->key] = $hold;
                        $byJob[(int) $hold->queue_job_id] = $hold;
                    }
                }
                foreach ($candidates as [$row, $job, $identity]) {
                    $snapshot = ['id' => (int) $row->id, 'job_class' => $job::class,
                        'work_id' => $job->{self::PRIORITY_JOBS[$job::class]},
                        'destination_queue' => self::PRIORITY_QUEUES[$job::class],
                        'payload_sha256' => hash('sha256', $row->payload),
                        'created_at' => (int) $row->created_at, 'available_at' => (int) $row->available_at];
                    if ($lock) {
                        $current = $locked->get($row->id);
                        $this->require($current && $this->priorityRowMatches($current, $snapshot), 'priority_row_changed_rerun_preview');
                    }
                    if ($identity !== null) {
                        $hold = $byKey[$identity['key']] ?? null;
                        $owned = $byJob[(int) $row->id] ?? null;
                        if (! $hold) {
                            $counts[$owned ? 'link_invalid_hold' : 'link_without_hold']++;

                            continue;
                        }
                        if ((int) $hold->queue_job_id !== (int) $row->id) {
                            $counts['link_hold_conflicts']++;

                            continue;
                        }
                        if (! $owned || $owned->key !== $identity['key'] || $hold->job_class !== LinkWebFormChat::class
                            || (int) $hold->work_id !== $identity['work_id'] || ! hash_equals($identity['command_sha256'], $hold->command_sha256)) {
                            $counts['link_invalid_hold']++;

                            continue;
                        }
                        $snapshot['hold_key'] = $identity['key'];
                        $snapshot['hold_sha256'] = hash('sha256', json_encode($hold, JSON_THROW_ON_ERROR));
                        $counts['eligible_link']++;
                    } else {
                        $counts['eligible_receive']++;
                    }
                    $moves[] = $snapshot;
                }
            });
        $counts['preserved_other'] = $counts['queue_jobs'] - count($moves);

        return ['version' => 1, 'action' => 'prioritize_legacy', 'queue' => 'edna', 'cutoff_kind' => 'jobs.id',
            'cutoff' => $cutoff, 'reservation_table_present' => $table, 'counts' => $counts, 'moves' => $moves];
    }

    private function reviewQuery(int $cutoff)
    {
        $query = DB::table('edna_organic_menus')->where('id', '<=', $cutoff)->where('state', 'review')
            ->whereIn('reason', self::REVIEW_REASONS)->where('send_state', 'pending')->where('transfer_state', 'pending')
            ->where('transfer_acknowledged', false)->where('entry_received_at', '>=', now()->subDay())
            ->where('entry_received_at', '<=', now())->where('expires_at', '>', now());
        foreach (self::REVIEW_EMPTY as $field) {
            $query->whereNull($field);
        }

        return $query;
    }

    private function reviewPlan(int $cutoff, bool $lock): array
    {
        $query = $this->reviewQuery($cutoff)->orderBy('id');
        if ($lock) {
            $query->lockForUpdate();
        }
        $rows = [];
        foreach ($query->get() as $menu) {
            // Hash the complete locked record so a changed encrypted identity or
            // any newly populated field invalidates the operator's earlier plan.
            $rows[] = ['id' => (int) $menu->id, 'entry_event_id' => (int) $menu->entry_event_id,
                'reason' => $menu->reason, 'record_sha256' => hash('sha256', json_encode($menu, JSON_THROW_ON_ERROR)),
                'entry_received_at' => CarbonImmutable::parse($menu->entry_received_at)->toIso8601String(),
                'expires_at' => CarbonImmutable::parse($menu->expires_at)->toIso8601String()];
        }

        return ['version' => 1, 'action' => 'reset_unattempted_review', 'cutoff_kind' => 'edna_organic_menus.id',
            'cutoff' => $cutoff, 'counts' => ['resettable' => count($rows)], 'menus' => $rows];
    }

    private function require(bool $condition, string $reason): void
    {
        if (! $condition) {
            throw new RuntimeException($reason);
        }
    }
}
