<?php

use App\Jobs\LinkWebFormChat;
use App\Jobs\PrepareEdnaOrganicLoan;
use App\Jobs\ProcessEdnaOrganicMenu;
use App\Jobs\ReceiveEdnaInKestra;
use App\Jobs\SubmitEdnaOrganicLoan;
use App\Services\EdnaWorkQueue;
use App\Services\WebFormChatRouting;
use Illuminate\Queue\Worker;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    Http::preventStrayRequests();
});

test('physical work priority preserves canonical command bytes and hold identity', function (string $class, string $destination) {
    $dispatcher = app(EdnaWorkQueue::class);
    $job = new $class(42);
    $command = serialize($job);
    $identity = $dispatcher->identity($job);

    expect($dispatcher->push($job))->toBeTrue()->and(serialize($job))->toBe($command);
    $queued = DB::table('jobs')->sole();
    $payload = json_decode($queued->payload, true, 32, JSON_THROW_ON_ERROR);
    expect($queued->queue)->toBe($destination)->and($payload['data']['command'])->toBe($command)
        ->and($dispatcher->identity($job))->toBe($identity)
        ->and(DB::table('edna_work_queue_keys')->sole()->key)->toBe($identity['key']);
})->with([
    [LinkWebFormChat::class, 'edna-web-reconcile'], [ProcessEdnaOrganicMenu::class, 'edna'],
    [PrepareEdnaOrganicLoan::class, 'edna'], [SubmitEdnaOrganicLoan::class, 'edna'],
]);

test('a retained legacy web job blocks low-priority duplicates before and after physical relocation', function () {
    $dispatcher = app(EdnaWorkQueue::class);
    $job = new LinkWebFormChat(42);
    $id = (int) Queue::connection('edna')->push($job, '', 'edna');
    $original = (array) DB::table('jobs')->find($id);
    $dispatcher->adopt($job, $id);
    $hold = (array) DB::table('edna_work_queue_keys')->sole();
    DB::table('web_form_chat_routes')->insert(['entry_event_id' => 42, 'state' => 'waiting',
        'available_at' => now()->subMinute(), 'created_at' => now()->subMinute(), 'updated_at' => now()]);

    expect($dispatcher->push($job))->toBeFalse()->and(app(WebFormChatRouting::class)->poll())->toBe(0);
    DB::table('jobs')->where('id', $id)->update(['queue' => 'edna-web-reconcile']);
    $dispatcher->adopt($job, $id);
    expect($dispatcher->push($job))->toBeFalse()->and(app(WebFormChatRouting::class)->poll())->toBe(0)
        ->and((array) DB::table('edna_work_queue_keys')->sole())->toBe($hold)
        ->and((array) DB::table('jobs')->find($id))->toBe(array_replace($original, ['queue' => 'edna-web-reconcile']));

    Queue::connection('edna')->pop('edna-web-reconcile')->delete();
    expect(DB::table('edna_work_queue_keys')->count())->toBe(0)
        ->and(app(WebFormChatRouting::class)->poll())->toBe(1)
        ->and(DB::table('jobs')->sole()->queue)->toBe('edna-web-reconcile');
});

test('work adoption rejects inbox and unrelated physical queues', function (string $class, string $destination) {
    $job = new $class(42);
    $id = (int) Queue::connection('edna')->push($job, '', $destination);
    expect(fn () => app(EdnaWorkQueue::class)->adopt($job, $id))->toThrow(RuntimeException::class, 'canonical command');
    expect(DB::table('edna_work_queue_keys')->count())->toBe(0)->and(DB::table('jobs')->count())->toBe(1);
})->with([
    [LinkWebFormChat::class, 'edna-inbox'], [LinkWebFormChat::class, 'unrelated'],
    [ProcessEdnaOrganicMenu::class, 'edna-web-reconcile'], [PrepareEdnaOrganicLoan::class, 'edna-inbox'],
    [SubmitEdnaOrganicLoan::class, 'edna-web-reconcile'],
]);

test('one Laravel worker prioritizes inbox FIFO then normal work then web reconciliation and still consumes legacy inbox jobs', function () {
    $dispatcher = app(EdnaWorkQueue::class);
    $dispatcher->push(new LinkWebFormChat(41));
    $low = (int) DB::table('jobs')->max('id');
    $dispatcher->push(new ProcessEdnaOrganicMenu(42));
    $normal = (int) DB::table('jobs')->max('id');
    $connection = Queue::connection('edna');
    $legacy = (int) $connection->push(new ReceiveEdnaInKestra(43), '', 'edna');
    $firstInbox = (int) $connection->push(new ReceiveEdnaInKestra(44), '', 'edna-inbox');
    $secondInbox = (int) $connection->push(new ReceiveEdnaInKestra(45), '', 'edna-inbox');
    $next = new ReflectionMethod(Worker::class, 'getNextJob');
    $worker = app('queue.worker');
    $selected = [];
    foreach (range(1, 5) as $_) {
        // Exercise the framework's actual ordered pop without executing handlers.
        $reserved = $next->invoke($worker, $connection, 'edna-inbox,edna,edna-web-reconcile');
        expect($reserved)->not->toBeNull();
        $selected[] = (int) $reserved->getJobId();
        $reserved->delete();
    }
    expect($selected)->toBe([$firstInbox, $secondInbox, $normal, $legacy, $low])
        ->and(DB::table('jobs')->count())->toBe(0)->and(DB::table('edna_work_queue_keys')->count())->toBe(0);
    Http::assertNothingSent();
});
