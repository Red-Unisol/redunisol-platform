<?php

namespace App\Services;

use App\Jobs\LinkWebFormChat;
use App\Jobs\PrepareEdnaOrganicLoan;
use App\Jobs\ProcessEdnaOrganicMenu;
use App\Jobs\SubmitEdnaOrganicLoan;
use Illuminate\Database\Query\Builder;
use Illuminate\Queue\DatabaseQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Testing\Fakes\QueueFake;
use RuntimeException;
use Throwable;

/** One physical queue row per canonical work command, including while reserved. */
class EdnaWorkQueue
{
    private const JOBS = [
        LinkWebFormChat::class => ['entryEventId', 'web_form_chat_routes.entry_event_id'],
        ProcessEdnaOrganicMenu::class => ['menuId', 'edna_organic_menus.id'],
        PrepareEdnaOrganicLoan::class => ['menuId', 'edna_organic_menus.id'],
        SubmitEdnaOrganicLoan::class => ['menuId', 'edna_organic_menus.id'],
    ];

    public function identity(object $job): array
    {
        $class = $job::class;
        $property = self::JOBS[$class][0] ?? null;
        $id = $property ? ($job->{$property} ?? null) : null;
        if (! is_int($id) || $id < 1 || serialize($job) !== serialize(new $class($id))) {
            throw new RuntimeException('Unsupported Edna work command.');
        }
        $command = serialize($job);

        return ['key' => hash('sha256', $class."\0".$id."\0".$command),
            'job_class' => $class, 'work_id' => $id, 'command_sha256' => hash('sha256', $command)];
    }

    /** Holds must be excluded before a bounded poll selects its next batch. */
    public function withoutPending(Builder $query, string $class, string $idColumn): Builder
    {
        if ((self::JOBS[$class][1] ?? null) !== $idColumn) {
            throw new RuntimeException('Unsupported Edna work query.');
        }

        return $query->whereNotExists(fn (Builder $held) => $held->selectRaw('1')->from('edna_work_queue_keys')
            ->where('job_class', $class)->whereColumn('work_id', $idColumn));
    }

    public function push(object $job): bool
    {
        $identity = $this->identity($job);
        [$queue, $observer] = $this->databaseQueue();

        return DB::transaction(function () use ($job, $identity, $queue, $observer): bool {
            $inserted = DB::table('edna_work_queue_keys')->insertOrIgnore($identity + [
                'queue_job_id' => null, 'created_at' => now(),
            ]);
            if (! $inserted) {
                return false;
            }
            $id = $queue->push($job, '', 'edna');
            if ((! is_int($id) && ! (is_string($id) && ctype_digit($id))) || (int) $id < 1) {
                throw new RuntimeException('Edna queue did not return a durable job.');
            }
            $this->assertJob($job, (int) $id);
            if (DB::table('edna_work_queue_keys')->where('key', $identity['key'])->whereNull('queue_job_id')
                ->update(['queue_job_id' => (int) $id]) !== 1) {
                throw new RuntimeException('Edna work hold could not be attached.');
            }
            // Existing Queue::fake assertions can observe the real transactional
            // enqueue. They never replace its jobs row or its foreign-key hold.
            if ($observer && $observer->shouldFakeJob($job)) {
                $observer->push($job, '', 'edna');
            }

            return true;
        });
    }

    /** Adopt a retained legacy row; never change its payload, attempts or timing. */
    public function adopt(object $job, int $queueJobId): void
    {
        if (DB::transactionLevel() < 1 || $queueJobId < 1) {
            throw new RuntimeException('Edna queue adoption requires an existing transaction.');
        }
        $this->databaseQueue();
        $identity = $this->identity($job);
        $this->assertJob($job, $queueJobId);
        DB::table('edna_work_queue_keys')->insertOrIgnore($identity + [
            'queue_job_id' => $queueJobId, 'created_at' => now(),
        ]);
        $hold = DB::table('edna_work_queue_keys')->where('key', $identity['key'])->lockForUpdate()->first();
        if (! $hold || (int) $hold->queue_job_id !== $queueJobId
            || $hold->job_class !== $identity['job_class'] || (int) $hold->work_id !== $identity['work_id']
            || ! hash_equals($hold->command_sha256, $identity['command_sha256'])) {
            throw new RuntimeException('Edna work is held by a different queue job.');
        }
    }

    private function assertJob(object $job, int $id): void
    {
        $row = DB::table('jobs')->where('id', $id)->lockForUpdate()->first(['queue', 'payload']);
        try {
            $payload = $row ? json_decode($row->payload, true, 32, JSON_THROW_ON_ERROR) : null;
        } catch (Throwable) {
            throw new RuntimeException('Edna work payload is unavailable.');
        }
        if (! $row || $row->queue !== 'edna' || ! is_array($payload)
            || ($payload['displayName'] ?? null) !== $job::class
            || ($payload['job'] ?? null) !== 'Illuminate\Queue\CallQueuedHandler@call'
            || ($payload['data']['commandName'] ?? null) !== $job::class
            || ($payload['data']['command'] ?? null) !== serialize($job)) {
            throw new RuntimeException('Edna queue job does not match its canonical command.');
        }
    }

    private function databaseQueue(): array
    {
        $config = config('queue.connections.edna');
        if (! is_array($config) || ($config['driver'] ?? '') !== 'database' || ($config['table'] ?? '') !== 'jobs'
            || ($config['connection'] ?? DB::getDefaultConnection()) !== DB::getDefaultConnection()
            || ($config['after_commit'] ?? false) !== false) {
            throw new RuntimeException('Edna work requires the default transactional jobs database.');
        }
        $manager = Queue::getFacadeRoot();
        $observer = null;
        if ($manager instanceof QueueFake) {
            if (! app()->runningUnitTests() || ! $manager->queue) {
                throw new RuntimeException('Edna work requires a durable queue.');
            }
            $observer = $manager;
            $manager = $manager->queue;
        }
        $queue = $manager->connection('edna');
        if (! $queue instanceof DatabaseQueue || $queue->getDatabase() !== DB::connection()) {
            throw new RuntimeException('Edna work queue is not on the ledger database.');
        }

        return [$queue, $observer];
    }
}
