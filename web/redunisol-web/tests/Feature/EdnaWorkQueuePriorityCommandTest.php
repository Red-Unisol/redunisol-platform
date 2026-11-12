<?php

use App\Jobs\LinkWebFormChat;
use App\Jobs\ProcessEdnaOrganicMenu;
use App\Jobs\ReceiveEdnaInKestra;
use App\Jobs\SendEdnaFlow;
use App\Services\EdnaWorkQueue;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 12)->setTime(14, 0));
    Http::preventStrayRequests();
});

function priorityQueueRun(array $arguments = []): array
{
    $exit = Artisan::call('edna:work-queue', $arguments);
    $output = Artisan::output();

    return [$exit, json_decode(trim($output), true, 64, JSON_THROW_ON_ERROR), $output];
}

function priorityQueueJob(object $job, array $changes = [], string $queue = 'edna', bool $adopt = false): int
{
    $id = (int) Queue::connection('edna')->push($job, '', $queue);
    if ($changes) {
        DB::table('jobs')->where('id', $id)->update($changes);
    }
    if ($adopt) {
        DB::transaction(fn () => (new EdnaWorkQueue)->adopt($job, $id));
    }

    return $id;
}

function priorityQueuePreview(): array
{
    [$exit, $preview] = priorityQueueRun(['action' => 'prioritize-preview']);
    expect($exit)->toBe(0);

    return $preview;
}

function priorityQueueApply(array $preview): array
{
    return priorityQueueRun(['action' => 'prioritize-apply', '--cutoff' => (string) $preview['plan']['cutoff'], '--preview-sha' => $preview['preview_sha']]);
}

test('priority preview is read only and apply changes only physical queue preserving ids payload timing and holds', function () {
    $link = priorityQueueJob(new LinkWebFormChat(51), ['available_at' => now()->addMinutes(3)->timestamp], adopt: true);
    $receive = priorityQueueJob(new ReceiveEdnaInKestra(62));
    $data = json_decode(DB::table('jobs')->where('id', $receive)->value('payload'), true);
    $data['private_extra'] = 'private-inbox-payload-sentinel';
    DB::table('jobs')->where('id', $receive)->update(['payload' => json_encode($data)]);
    $before = DB::table('jobs')->orderBy('id')->get()->keyBy('id');
    $holds = DB::table('edna_work_queue_keys')->orderBy('key')->get()->toJson();
    [$exit, $preview, $output] = priorityQueueRun(['action' => 'prioritize-preview']);
    expect($exit)->toBe(0)->and($preview['plan']['counts']['eligible_receive'])->toBe(1)
        ->and($preview['plan']['counts']['eligible_link'])->toBe(1)->and($preview['plan']['counts']['preserved_other'])->toBe(0)
        ->and($output)->not->toContain('private-inbox-payload-sentinel', 'commandName', 'O:')
        ->and(DB::table('jobs')->orderBy('id')->get()->keyBy('id')->toJson())->toBe($before->toJson())
        ->and(DB::table('edna_work_queue_keys')->orderBy('key')->get()->toJson())->toBe($holds);
    [$exit, $applied] = priorityQueueApply($preview);
    expect($exit)->toBe(0)->and($applied['moved'])->toBe(2)
        ->and($applied['moved_by_queue'])->toBe(['edna-inbox' => 1, 'edna-web-reconcile' => 1]);
    foreach ([$link => 'edna-web-reconcile', $receive => 'edna-inbox'] as $id => $destination) {
        $expected = (array) $before[$id];
        $expected['queue'] = $destination;
        expect((array) DB::table('jobs')->where('id', $id)->first())->toBe($expected);
    }
    expect(DB::table('edna_work_queue_keys')->orderBy('key')->get()->toJson())->toBe($holds)
        ->and((new EdnaWorkQueue)->push(new LinkWebFormChat(51)))->toBeFalse()
        ->and(DB::table('edna_organic_menus')->count())->toBe(0)
        ->and(DB::table('web_form_chat_routes')->count())->toBe(0);
    Http::assertNothingSent();
});

test('priority preserves reserved attempted variants chained unknown classes and every other lane', function () {
    $preserved = [
        priorityQueueJob(new ReceiveEdnaInKestra(1), ['reserved_at' => now()->timestamp]),
        priorityQueueJob(new ReceiveEdnaInKestra(2), ['attempts' => 1]),
        priorityQueueJob(new LinkWebFormChat(3), ['reserved_at' => now()->timestamp], adopt: true),
        priorityQueueJob(new LinkWebFormChat(4), ['attempts' => 1], adopt: true),
        priorityQueueJob((new ReceiveEdnaInKestra(5))->onQueue('edna-inbox')),
        priorityQueueJob((new LinkWebFormChat(6))->onQueue('edna-web-reconcile')),
        priorityQueueJob((new ReceiveEdnaInKestra(7))->chain([new SendEdnaFlow(8)])),
        priorityQueueJob(new ReceiveEdnaInKestra(0)), priorityQueueJob(new LinkWebFormChat(-1)),
        priorityQueueJob(new SendEdnaFlow(8)), priorityQueueJob(new ProcessEdnaOrganicMenu(9)),
        priorityQueueJob(new ReceiveEdnaInKestra(10), [], 'edna-inbox'),
        priorityQueueJob(new LinkWebFormChat(11), [], 'edna-web-reconcile', true),
        priorityQueueJob(new ReceiveEdnaInKestra(12), [], 'another-lane'),
        priorityQueueJob(new ReceiveEdnaInKestra(13), ['payload' => '{malformed']),
    ];
    $before = DB::table('jobs')->orderBy('id')->get()->toJson();
    $holds = DB::table('edna_work_queue_keys')->orderBy('key')->get()->toJson();
    $preview = priorityQueuePreview();
    expect($preview['plan']['counts']['reserved_or_attempted'])->toBe(4)
        ->and($preview['plan']['counts']['unsupported_or_noncanonical'])->toBe(8)
        ->and($preview['plan']['counts']['preserved_other'])->toBe(12);
    [$exit, $result] = priorityQueueApply($preview);
    expect($exit)->toBe(0)->and($result['moved'])->toBe(0)
        ->and(DB::table('jobs')->whereIn('id', $preserved)->orderBy('id')->get()->toJson())->toBe($before)
        ->and(DB::table('edna_work_queue_keys')->orderBy('key')->get()->toJson())->toBe($holds);
});

test('priority counts missing and invalid link holds and never adopts or repairs them', function () {
    $missing = priorityQueueJob(new LinkWebFormChat(10));
    $invalid = priorityQueueJob(new LinkWebFormChat(11), adopt: true);
    DB::table('edna_work_queue_keys')->where('queue_job_id', $invalid)->update(['command_sha256' => str_repeat('b', 64)]);
    $receive = priorityQueueJob(new ReceiveEdnaInKestra(12));
    $before = DB::table('edna_work_queue_keys')->orderBy('key')->get()->toJson();
    $preview = priorityQueuePreview();
    expect($preview['plan']['counts']['link_without_hold'])->toBe(1)
        ->and($preview['plan']['counts']['link_invalid_hold'])->toBe(1)
        ->and($preview['plan']['counts']['eligible_receive'])->toBe(1)
        ->and($preview['plan']['counts']['eligible_link'])->toBe(0);
    [$exit] = priorityQueueApply($preview);
    expect($exit)->toBe(0)->and(DB::table('jobs')->where('id', $receive)->value('queue'))->toBe('edna-inbox')
        ->and(DB::table('jobs')->whereIn('id', [$missing, $invalid])->pluck('queue')->all())->toBe(['edna', 'edna'])
        ->and(DB::table('edna_work_queue_keys')->orderBy('key')->get()->toJson())->toBe($before);
});

test('priority conflicting physical holder blocks the entire apply instead of choosing a first duplicate', function () {
    priorityQueueJob(new LinkWebFormChat(10));
    priorityQueueJob(new LinkWebFormChat(10), adopt: true);
    priorityQueueJob(new ReceiveEdnaInKestra(12));
    $before = DB::table('jobs')->orderBy('id')->get()->toJson();
    $preview = priorityQueuePreview();
    expect($preview['plan']['counts']['link_hold_conflicts'])->toBe(1);
    [$exit, $result] = priorityQueueApply($preview);
    expect($exit)->toBe(1)->and($result['reason'])->toBe('reservation_conflict_requires_review')
        ->and(DB::table('jobs')->orderBy('id')->get()->toJson())->toBe($before);
});

test('priority explicit apply requires the matching cutoff and sha', function (array $options) {
    priorityQueueJob(new ReceiveEdnaInKestra(12));
    [$exit, $result] = priorityQueueRun(['action' => 'prioritize-apply'] + $options);
    expect($exit)->toBe(1)->and($result['mode'])->toBe('failed')
        ->and(DB::table('jobs')->sole()->queue)->toBe('edna');
})->with(array_map(fn ($value) => [$value], [[], ['--cutoff' => '1'],
    ['--cutoff' => '1', '--preview-sha' => str_repeat('a', 64)]]));

test('priority rejects previews made stale by every mutable job field', function (array $change) {
    $id = priorityQueueJob(new ReceiveEdnaInKestra(12));
    $preview = priorityQueuePreview();
    DB::table('jobs')->where('id', $id)->update($change);
    [$exit, $result] = priorityQueueApply($preview);
    expect($exit)->toBe(1)->and($result['reason'])->toBe('preview_changed_rerun_preview')
        ->and(DB::table('jobs')->where('id', $id)->value('queue'))->toBe($change['queue'] ?? 'edna');
})->with(array_map(fn ($value) => [$value], [['reserved_at' => 1800000000], ['attempts' => 1],
    ['available_at' => 1800000000], ['created_at' => 1800000000], ['payload' => '{"changed":true}'], ['queue' => 'edna-inbox']]));

test('priority rejects a changed or missing hold rather than repairing or moving its job', function (bool $delete) {
    $id = priorityQueueJob(new LinkWebFormChat(12), adopt: true);
    $preview = priorityQueuePreview();
    if ($delete) {
        DB::table('edna_work_queue_keys')->where('queue_job_id', $id)->delete();
    } else {
        DB::table('edna_work_queue_keys')->where('queue_job_id', $id)->update(['command_sha256' => str_repeat('c', 64)]);
    }
    [$exit, $result] = priorityQueueApply($preview);
    expect($exit)->toBe(1)->and($result['reason'])->toBe('preview_changed_rerun_preview')
        ->and(DB::table('jobs')->where('id', $id)->value('queue'))->toBe('edna');
})->with([true, false]);

test('priority cutoff protects new jobs and legacy dedupe protects both destination lanes', function () {
    $link = priorityQueueJob(new LinkWebFormChat(10), adopt: true);
    $receive = priorityQueueJob(new ReceiveEdnaInKestra(12));
    $preview = priorityQueuePreview();
    $new = priorityQueueJob(new ReceiveEdnaInKestra(13));
    [$exit] = priorityQueueApply($preview);
    expect($exit)->toBe(0)->and(DB::table('jobs')->where('id', $new)->value('queue'))->toBe('edna');
    $before = DB::table('jobs')->whereIn('id', [$link, $receive])->orderBy('id')->get()->toJson();
    [, $dedupe] = priorityQueueRun();
    [$exit] = priorityQueueRun(['action' => 'apply', '--cutoff' => (string) $dedupe['plan']['cutoff'], '--preview-sha' => $dedupe['preview_sha']]);
    expect($exit)->toBe(0)->and(DB::table('jobs')->whereIn('id', [$link, $receive])->orderBy('id')->get()->toJson())->toBe($before)
        ->and(DB::table('edna_work_queue_keys')->count())->toBe(1);
});

test('priority rolls back every prior move if a row or hold changes before its update', function (string $change) {
    $first = priorityQueueJob(new ReceiveEdnaInKestra(10));
    $second = priorityQueueJob(new LinkWebFormChat(11), adopt: true);
    $preview = priorityQueuePreview();
    $before = DB::table('jobs')->orderBy('id')->get()->toJson();
    $holds = DB::table('edna_work_queue_keys')->orderBy('key')->get()->toJson();
    $enabled = true;
    DB::listen(function (QueryExecuted $query) use (&$enabled, $change, $second): void {
        if (! $enabled || ! str_starts_with(strtolower($query->sql), 'update "jobs" set "queue"')) {
            return;
        }
        $enabled = false;
        if ($change === 'row') {
            DB::table('jobs')->where('id', $second)->update(['attempts' => 1]);
        } else {
            DB::table('edna_work_queue_keys')->where('queue_job_id', $second)->update(['command_sha256' => str_repeat('c', 64)]);
        }
    });
    try {
        [$exit, $result] = priorityQueueApply($preview);
    } finally {
        $enabled = false;
    }
    expect($exit)->toBe(1)->and($result['reason'])->toBe($change === 'row' ? 'priority_row_changed_rerun_preview' : 'priority_hold_changed_rerun_preview')
        ->and(DB::table('jobs')->orderBy('id')->get()->toJson())->toBe($before)
        ->and(DB::table('edna_work_queue_keys')->orderBy('key')->get()->toJson())->toBe($holds)
        ->and(DB::table('jobs')->where('id', $first)->value('queue'))->toBe('edna');
})->with(['row', 'hold']);
