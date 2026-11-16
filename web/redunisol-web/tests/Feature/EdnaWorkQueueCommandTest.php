<?php

use App\Jobs\LinkWebFormChat;
use App\Jobs\PrepareEdnaOrganicLoan;
use App\Jobs\ProcessEdnaOrganicMenu;
use App\Jobs\SendEdnaFlow;
use App\Services\EdnaWorkQueue;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 12)->setTime(8, 0));
    Http::preventStrayRequests();
});

function workQueueRun(array $arguments = []): array
{
    $exit = Artisan::call('edna:work-queue', $arguments);
    $output = Artisan::output();

    return [$exit, json_decode(trim($output), true, 64, JSON_THROW_ON_ERROR), $output];
}

function workQueuePush(object $job, array $changes = [], string $queue = 'edna'): int
{
    $id = (int) Queue::connection('edna')->push($job, '', $queue);
    if ($changes) {
        DB::table('jobs')->where('id', $id)->update($changes);
    }

    return $id;
}

function workQueueApply(array $preview, string $action = 'apply'): array
{
    return workQueueRun(['action' => $action, '--cutoff' => (string) $preview['plan']['cutoff'], '--preview-sha' => $preview['preview_sha']]);
}

function workQueueReview(array $changes = []): int
{
    return DB::table('edna_organic_menus')->insertGetId(array_replace([
        'request_id' => (string) Str::uuid(), 'entry_event_id' => 7000 + DB::table('edna_organic_menus')->count(),
        'subject_id' => '2423', 'cascade_id' => '2557', 'phone_hash' => str_repeat('a', 64),
        'recipient' => 'sensitive-encrypted-recipient-sentinel', 'state' => 'review', 'reason' => 'native_message_pending',
        'send_state' => 'pending', 'transfer_state' => 'pending', 'transfer_acknowledged' => false,
        'entry_received_at' => now()->subHour(), 'expires_at' => now()->addHours(23), 'attempts' => 6,
        'created_at' => now()->subHour(), 'updated_at' => now(),
    ], $changes));
}

test('work queue default preview is read only and reveals only technical identifiers and hashes', function () {
    $first = workQueuePush(new LinkWebFormChat(47));
    $second = workQueuePush(new LinkWebFormChat(47));
    $payload = DB::table('jobs')->where('id', $second)->value('payload');
    $data = json_decode($payload, true);
    $data['private_extra'] = 'private-payload-sentinel';
    DB::table('jobs')->where('id', $second)->update(['payload' => json_encode($data)]);
    $before = DB::table('jobs')->orderBy('id')->get()->toJson();
    [$exit, $preview, $output] = workQueueRun();
    expect($exit)->toBe(0)->and($preview['mode'])->toBe('preview')
        ->and($preview['plan']['counts']['duplicates'])->toBe(1)
        ->and($preview['plan']['groups'][0]['keep']['id'])->toBe($first)
        ->and($preview['plan']['groups'][0]['delete'][0]['id'])->toBe($second)
        ->and($output)->not->toContain('private-payload-sentinel', 'commandName', 'O:')
        ->and(DB::table('jobs')->orderBy('id')->get()->toJson())->toBe($before)
        ->and(DB::table('edna_work_queue_keys')->count())->toBe(0);
    Http::assertNothingSent();
});

test('work queue apply keeps oldest per class and id and seeds all retained legacy jobs atomically', function () {
    $first = workQueuePush(new LinkWebFormChat(47));
    $duplicate = workQueuePush(new LinkWebFormChat(47));
    $menu = workQueuePush(new ProcessEdnaOrganicMenu(47));
    workQueuePush(new ProcessEdnaOrganicMenu(47));
    $single = workQueuePush(new LinkWebFormChat(48));
    [, $preview] = workQueueRun();
    [$exit, $applied] = workQueueApply($preview);
    expect($exit)->toBe(0)->and($applied['deleted'])->toBe(2)->and($applied['adopted'])->toBe(3)
        ->and(DB::table('jobs')->orderBy('id')->pluck('id')->map(fn ($id) => (int) $id)->all())->toBe([$first, $menu, $single])
        ->and(DB::table('jobs')->where('id', $duplicate)->exists())->toBeFalse()
        ->and(DB::table('edna_work_queue_keys')->orderBy('queue_job_id')->pluck('queue_job_id')->map(fn ($id) => (int) $id)->all())->toBe([$first, $menu, $single])
        ->and((new EdnaWorkQueue)->push(new LinkWebFormChat(47)))->toBeFalse()
        ->and((new EdnaWorkQueue)->push(new ProcessEdnaOrganicMenu(47)))->toBeFalse();
    Http::assertNothingSent();
});

test('work queue preserves every reserved attempted variant chained unknown and other queue job', function () {
    workQueuePush(new LinkWebFormChat(47));
    workQueuePush(new LinkWebFormChat(47));
    $preserved = [workQueuePush(new LinkWebFormChat(47), ['reserved_at' => now()->timestamp]),
        workQueuePush(new LinkWebFormChat(47), ['attempts' => 1]),
        workQueuePush((new LinkWebFormChat(47))->onQueue('edna')),
        workQueuePush((new LinkWebFormChat(47))->chain([new SendEdnaFlow(8)])),
        workQueuePush(new LinkWebFormChat(0)), workQueuePush(new ProcessEdnaOrganicMenu(-1)),
        workQueuePush(new SendEdnaFlow(47)), workQueuePush(new PrepareEdnaOrganicLoan(47)),
        workQueuePush(new LinkWebFormChat(47), [], 'default')];
    $bad = workQueuePush(new LinkWebFormChat(47), ['payload' => '{invalid-json']);
    $preserved[] = $bad;
    $wrongEnvelope = workQueuePush(new LinkWebFormChat(47));
    $payload = json_decode(DB::table('jobs')->where('id', $wrongEnvelope)->value('payload'), true);
    $payload['data']['commandName'] = SendEdnaFlow::class;
    DB::table('jobs')->where('id', $wrongEnvelope)->update(['payload' => json_encode($payload)]);
    $preserved[] = $wrongEnvelope;
    $before = DB::table('jobs')->whereIn('id', $preserved)->orderBy('id')->get()->toJson();
    [, $preview] = workQueueRun();
    expect($preview['plan']['counts']['duplicates'])->toBe(1);
    [$exit] = workQueueApply($preview);
    expect($exit)->toBe(0)->and(DB::table('jobs')->whereIn('id', $preserved)->orderBy('id')->get()->toJson())->toBe($before);
});

test('work queue requires explicit matching preview and cutoff before any deletion', function (array $args) {
    workQueuePush(new LinkWebFormChat(47));
    workQueuePush(new LinkWebFormChat(47));
    [$exit, $result] = workQueueRun(['action' => 'apply'] + $args);
    expect($exit)->toBe(1)->and($result['mode'])->toBe('failed')->and(DB::table('jobs')->count())->toBe(2)
        ->and(DB::table('edna_work_queue_keys')->count())->toBe(0);
})->with(array_map(fn ($value) => [$value], [[], ['--cutoff' => '2'], ['--cutoff' => '-1', '--preview-sha' => str_repeat('a', 64)],
    ['--cutoff' => '2', '--preview-sha' => str_repeat('a', 64)]]));

test('work queue rejects stale plans when payload timing reservation or attempts change', function (array $change) {
    workQueuePush(new LinkWebFormChat(47));
    $second = workQueuePush(new LinkWebFormChat(47));
    [, $preview] = workQueueRun();
    DB::table('jobs')->where('id', $second)->update($change);
    [$exit, $result] = workQueueApply($preview);
    expect($exit)->toBe(1)->and($result['reason'])->toBe('preview_changed_rerun_preview')
        ->and(DB::table('jobs')->count())->toBe(2)->and(DB::table('edna_work_queue_keys')->count())->toBe(0);
})->with(array_map(fn ($value) => [$value], [['reserved_at' => 1800000000], ['attempts' => 1], ['available_at' => 1800000000], ['payload' => '{"changed":true}']]));

test('work queue cutoff preserves jobs arriving after the preview', function () {
    workQueuePush(new LinkWebFormChat(47));
    workQueuePush(new LinkWebFormChat(47));
    [, $preview] = workQueueRun();
    $new = workQueuePush(new LinkWebFormChat(47));
    [$exit, $result] = workQueueApply($preview);
    expect($exit)->toBe(0)->and($result['deleted'])->toBe(1)->and(DB::table('jobs')->where('id', $new)->exists())->toBeTrue();
});

test('work queue bulk cleanup spans scan and delete chunks without losing the oldest keeper', function () {
    $first = workQueuePush(new LinkWebFormChat(47));
    $row = (array) DB::table('jobs')->where('id', $first)->first();
    unset($row['id']);
    foreach (array_chunk(array_fill(0, 1001, $row), 100) as $rows) {
        DB::table('jobs')->insert($rows);
    }
    [, $preview] = workQueueRun();
    expect($preview['plan']['counts']['canonical_unreserved_jobs'])->toBe(1002)
        ->and($preview['plan']['counts']['duplicates'])->toBe(1001);
    [$exit, $result] = workQueueApply($preview);
    expect($exit)->toBe(0)->and($result['deleted'])->toBe(1001)
        ->and((int) DB::table('jobs')->sole()->id)->toBe($first)
        ->and((int) DB::table('edna_work_queue_keys')->sole()->queue_job_id)->toBe($first);
});

test('work queue bulk plan is invalidated by a new dispatcher hold outside its legacy cutoff', function () {
    workQueuePush(new LinkWebFormChat(47));
    workQueuePush(new LinkWebFormChat(47));
    [, $preview] = workQueueRun();
    expect((new EdnaWorkQueue)->push(new LinkWebFormChat(47)))->toBeTrue();
    $held = (int) DB::table('edna_work_queue_keys')->sole()->queue_job_id;
    [$exit, $result] = workQueueApply($preview);
    expect($exit)->toBe(1)->and($result['reason'])->toBe('preview_changed_rerun_preview')
        ->and(DB::table('jobs')->count())->toBe(3)
        ->and((int) DB::table('edna_work_queue_keys')->sole()->queue_job_id)->toBe($held);
});

test('work queue preserves an existing newer canonical reservation instead of moving its mapping', function () {
    $first = workQueuePush(new LinkWebFormChat(47));
    $second = workQueuePush(new LinkWebFormChat(47));
    DB::transaction(fn () => (new EdnaWorkQueue)->adopt(new LinkWebFormChat(47), $second));
    [, $preview] = workQueueRun();
    [$exit] = workQueueApply($preview);
    expect($exit)->toBe(0)->and((int) DB::table('edna_work_queue_keys')->sole()->queue_job_id)->toBe($second)
        ->and(DB::table('jobs')->where('id', $first)->exists())->toBeFalse();
});

test('work queue preserves conflicting reserved holds and rolls every deletion back if adoption fails', function () {
    workQueuePush(new LinkWebFormChat(47));
    workQueuePush(new LinkWebFormChat(47));
    $reserved = workQueuePush(new LinkWebFormChat(47), ['reserved_at' => now()->timestamp]);
    DB::transaction(fn () => (new EdnaWorkQueue)->adopt(new LinkWebFormChat(47), $reserved));
    [, $preview] = workQueueRun();
    expect($preview['plan']['counts']['reservation_conflicts'])->toBe(1);
    [$exit, $result] = workQueueApply($preview);
    expect($exit)->toBe(1)->and($result['reason'])->toBe('reservation_conflict_requires_review')->and(DB::table('jobs')->count())->toBe(3);
    DB::table('edna_work_queue_keys')->delete();
    [, $preview] = workQueueRun();
    $fake = Mockery::mock(EdnaWorkQueue::class)->makePartial();
    $fake->shouldReceive('adopt')->once()->andThrow(new RuntimeException(str_repeat('a', 64)));
    app()->instance(EdnaWorkQueue::class, $fake);
    [$exit, $result, $output] = workQueueApply($preview);
    expect($exit)->toBe(1)->and($result['reason'])->toBe('work_queue_operation_failed')
        ->and($output)->not->toContain(str_repeat('a', 64))->and(DB::table('jobs')->count())->toBe(3)
        ->and(DB::table('edna_work_queue_keys')->count())->toBe(0);
});

test('review reset is separate preview-bound work and preserves original identity and expiry', function () {
    $first = workQueueReview();
    workQueueReview(['reason' => 'provider_reads_pending']);
    $original = DB::table('edna_organic_menus')->where('id', $first)->first();
    [, $queuePreview] = workQueueRun();
    expect($queuePreview['plan']['counts']['duplicates'])->toBe(0)->and(DB::table('edna_organic_menus')->where('id', $first)->value('state'))->toBe('review');
    [, $preview, $output] = workQueueRun(['action' => 'review-preview']);
    expect($preview['plan']['counts']['resettable'])->toBe(2)->and($output)->not->toContain('sensitive-encrypted-recipient-sentinel');
    [$exit, $result] = workQueueApply($preview, 'review-apply');
    $after = DB::table('edna_organic_menus')->where('id', $first)->first();
    expect($exit)->toBe(0)->and($result['reset'])->toBe(2)->and($after->state)->toBe('pending')->and($after->reason)->toBeNull()
        ->and($after->request_id)->toBe($original->request_id)->and($after->entry_event_id)->toBe($original->entry_event_id)
        ->and($after->expires_at)->toBe($original->expires_at)->and($after->recipient)->toBe($original->recipient)
        ->and($after->attempts)->toBe(6)->and(DB::table('jobs')->count())->toBe(0);
    Http::assertNothingSent();
});

test('review reset excludes every human native send choice CRM lease intent or acknowledgement advance', function (array $change) {
    $id = workQueueReview($change);
    [, $preview] = workQueueRun(['action' => 'review-preview']);
    expect($preview['plan']['counts']['resettable'])->toBe(0)
        ->and(DB::table('edna_organic_menus')->where('id', $id)->value('state'))->toBe($change['state'] ?? 'review');
})->with(array_map(fn ($value) => [$value], [
    ['state' => 'waiting'], ['reason' => 'human_attention'], ['entry_received_at' => '2026-11-10 08:00:00'],
    ['entry_received_at' => '2026-11-12 08:01:00'], ['expires_at' => '2026-11-12 08:00:00'],
    ['send_state' => 'accepted'], ['send_reason' => 'uncertain'], ['proof' => '{}'], ['chat_id' => 8], ['session_id' => 9],
    ['lease_token' => '11111111-1111-4111-8111-111111111111'], ['lease_until' => '2026-11-12 07:00:00'],
    ['send_started_at' => '2026-11-12 07:00:00'], ['accepted_at' => '2026-11-12 07:00:00'], ['confirmed_at' => '2026-11-12 07:00:00'],
    ['outgoing_message_id' => '7'], ['choice_event_id' => 9], ['choice' => 'loan'], ['choice_received_at' => '2026-11-12 07:00:00'],
    ['canonical_menu_id' => 8], ['flow_send_id' => 8], ['case_id' => '8'], ['deal_id' => '8'], ['seller_id' => '5737'],
    ['profile_snapshot' => 'saved'], ['profile_evidence' => '{}'], ['transfer_intent' => '{}'], ['transfer_acknowledged' => true], ['transfer_state' => 'unknown'],
]));

test('review reset rejects a changed encrypted identity or newly acquired lease', function (array $change) {
    $id = workQueueReview();
    [, $preview] = workQueueRun(['action' => 'review-preview']);
    DB::table('edna_organic_menus')->where('id', $id)->update($change);
    [$exit, $result] = workQueueApply($preview, 'review-apply');
    expect($exit)->toBe(1)->and($result['reason'])->toBe('preview_changed_rerun_preview')
        ->and(DB::table('edna_organic_menus')->where('id', $id)->value('state'))->toBe('review');
})->with(array_map(fn ($value) => [$value], [['recipient' => 'changed-encrypted-identity'], ['lease_token' => '11111111-1111-4111-8111-111111111111']]));
