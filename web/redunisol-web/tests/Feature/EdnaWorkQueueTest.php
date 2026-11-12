<?php

use App\Jobs\LinkWebFormChat;
use App\Jobs\PrepareEdnaOrganicLoan;
use App\Jobs\ProcessEdnaOrganicMenu;
use App\Jobs\SubmitEdnaOrganicLoan;
use App\Services\EdnaOrganicLoan;
use App\Services\EdnaOrganicMenu;
use App\Services\EdnaWorkQueue;
use App\Services\WebFormChatRouting;
use Illuminate\Queue\Events\JobQueued;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 11, 12)->setTime(12, 0));
    Http::preventStrayRequests();
});

function workQueueMenu(string $state = 'pending'): int
{
    return DB::table('edna_organic_menus')->insertGetId([
        'request_id' => (string) Str::uuid(), 'entry_event_id' => 1000 + DB::table('edna_organic_menus')->count(),
        'subject_id' => '2423', 'cascade_id' => '2557', 'phone_hash' => str_repeat('a', 64),
        'recipient' => 'not-read-by-queue', 'state' => $state, 'entry_received_at' => now(),
        'expires_at' => now()->addDay(), 'available_at' => now()->subMinute(),
        'created_at' => now()->subMinute(), 'updated_at' => now()->subMinute(),
    ]);
}

test('queued and reserved work stays unique until a real queue ACK deletes its hold', function (string $class) {
    $dispatcher = app(EdnaWorkQueue::class);
    expect($dispatcher->push(new $class(42)))->toBeTrue()
        ->and(DB::table('jobs')->count())->toBe(1);
    $this->travel(10)->minutes();
    expect($dispatcher->push(new $class(42)))->toBeFalse();
    $reserved = Queue::connection('edna')->pop('edna');
    expect($reserved)->not->toBeNull();
    $id = $reserved->getJobId();
    $this->travel(3)->minutes();
    expect($dispatcher->push(new $class(42)))->toBeFalse();
    // A crashed worker's reservation expires on the SAME database queue row.
    $recovered = Queue::connection('edna')->pop('edna');
    expect($recovered->getJobId())->toBe($id)
        ->and(DB::table('edna_work_queue_keys')->count())->toBe(1);
    $recovered->delete();
    expect(DB::table('jobs')->count())->toBe(0)
        ->and(DB::table('edna_work_queue_keys')->count())->toBe(0)
        ->and($dispatcher->push(new $class(42)))->toBeTrue();
})->with([LinkWebFormChat::class, ProcessEdnaOrganicMenu::class, PrepareEdnaOrganicLoan::class, SubmitEdnaOrganicLoan::class]);

test('failure after physical enqueue rolls back both the queue row and placeholder', function () {
    Event::listen(JobQueued::class, fn () => throw new RuntimeException('test enqueue interruption'));
    expect(fn () => app(EdnaWorkQueue::class)->push(new ProcessEdnaOrganicMenu(42)))
        ->toThrow(RuntimeException::class, 'test enqueue interruption');
    expect(DB::table('jobs')->count())->toBe(0)->and(DB::table('edna_work_queue_keys')->count())->toBe(0);
    Event::forget(JobQueued::class);
    expect(app(EdnaWorkQueue::class)->push(new ProcessEdnaOrganicMenu(42)))->toBeTrue();
});

test('an outer business transaction rollback cannot orphan a queue hold', function () {
    expect(fn () => DB::transaction(function () {
        app(EdnaWorkQueue::class)->push(new LinkWebFormChat(42));
        throw new RuntimeException('business rollback');
    }))->toThrow(RuntimeException::class, 'business rollback');
    expect(DB::table('jobs')->count())->toBe(0)->and(DB::table('edna_work_queue_keys')->count())->toBe(0);
});

test('queue holds require the same default database and immediate jobs table insert', function (string $setting, mixed $value) {
    config()->set('queue.connections.edna.'.$setting, $value);
    expect(fn () => app(EdnaWorkQueue::class)->push(new ProcessEdnaOrganicMenu(42)))
        ->toThrow(RuntimeException::class, 'default transactional jobs database');
    expect(DB::table('jobs')->count())->toBe(0)->and(DB::table('edna_work_queue_keys')->count())->toBe(0);
})->with([['driver', 'redis'], ['table', 'other_jobs'], ['connection', 'other_database'], ['after_commit', true]]);

test('noncanonical queueable properties cannot bypass the dedupe identity or defer its insert', function () {
    $job = (new ProcessEdnaOrganicMenu(42))->afterCommit();
    expect(fn () => app(EdnaWorkQueue::class)->push($job))->toThrow(RuntimeException::class, 'Unsupported Edna work command');
    expect(DB::table('jobs')->count())->toBe(0);
});

test('bounded menu polls skip held work before selecting the next batch', function () {
    for ($index = 0; $index < 27; $index++) {
        workQueueMenu();
    }
    $menus = app(EdnaOrganicMenu::class);
    expect($menus->poll(25))->toBe(25);
    $this->travel(2)->minutes();
    expect($menus->poll(25))->toBe(2);
    $this->travel(2)->minutes();
    expect($menus->poll(25))->toBe(0)->and(DB::table('jobs')->count())->toBe(27);
    Queue::connection('edna')->pop('edna')->delete();
    expect($menus->poll(25))->toBe(1)->and(DB::table('jobs')->count())->toBe(27);
});

test('web route polls cannot multiply queued or reserved work and remain fair', function () {
    for ($id = 1; $id <= 27; $id++) {
        DB::table('web_form_chat_routes')->insert(['entry_event_id' => $id, 'state' => 'waiting',
            'reason' => 'native_message_pending', 'available_at' => now()->subMinute(),
            'created_at' => now()->subMinute(), 'updated_at' => now()->subMinute()]);
    }
    $routes = app(WebFormChatRouting::class);
    expect($routes->poll(25))->toBe(25);
    $reserved = Queue::connection('edna')->pop('edna');
    $this->travel(2)->minutes();
    expect($routes->poll(25))->toBe(2);
    $this->travel(2)->minutes();
    expect($routes->poll(25))->toBe(0)->and(DB::table('jobs')->count())->toBe(27);
    $reserved->delete();
    expect($routes->poll(25))->toBe(1);
});

test('loan preparation and submission poll each keep only one durable queue entry', function () {
    $prepare = workQueueMenu('loan_pending');
    $submit = workQueueMenu('submission_pending');
    $loans = app(EdnaOrganicLoan::class);
    expect($loans->poll(25))->toBe(2);
    $this->travel(2)->minutes();
    expect($loans->poll(25))->toBe(0)
        ->and($loans->enqueue($prepare))->toBeFalse()->and($loans->enqueue($submit))->toBeFalse()
        ->and(DB::table('jobs')->count())->toBe(2);
});

test('an adopted legacy job is held without changing its payload or queue timing', function () {
    $job = new LinkWebFormChat(42);
    $id = Queue::connection('edna')->push($job, '', 'edna');
    $before = (array) DB::table('jobs')->find($id);
    app(EdnaWorkQueue::class)->adopt($job, (int) $id);
    expect((array) DB::table('jobs')->find($id))->toBe($before)
        ->and(app(EdnaWorkQueue::class)->push($job))->toBeFalse();
});

test('adoption never steals another job hold or accepts a changed command', function () {
    $dispatcher = app(EdnaWorkQueue::class);
    $job = new LinkWebFormChat(42);
    $dispatcher->push($job);
    $other = Queue::connection('edna')->push($job, '', 'edna');
    expect(fn () => $dispatcher->adopt($job, (int) $other))->toThrow(RuntimeException::class, 'held by a different queue job');
    expect(fn () => $dispatcher->adopt(new LinkWebFormChat(43), (int) $other))->toThrow(RuntimeException::class, 'canonical command');
    expect(DB::table('edna_work_queue_keys')->count())->toBe(1);
});

test('two independent producers converge on one default-database job with a cascading foreign key', function () {
    $file = tempnam(sys_get_temp_dir(), 'edna-work-');
    $scriptFile = $file.'.php';
    $barrier = $file.'-barrier';
    mkdir($barrier);
    $default = DB::getDefaultConnection();
    config()->set('database.connections.work_queue_concurrency', array_replace(config('database.connections.sqlite'), [
        'url' => null, 'database' => $file, 'foreign_key_constraints' => true, 'busy_timeout' => 5000,
    ]));
    try {
        DB::setDefaultConnection('work_queue_concurrency');
        Schema::clearResolvedInstance('db.schema');
        (require database_path('migrations/0001_01_01_000002_create_jobs_table.php'))->up();
        (require database_path('migrations/2026_11_12_130000_create_edna_work_queue_keys.php'))->up();
        DB::setDefaultConnection($default);
        Schema::clearResolvedInstance('db.schema');
        $script = <<<'PHP'
require 'vendor/autoload.php';
$app=require 'bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
config()->set('database.default','sqlite');
config()->set('database.connections.sqlite.url',null);
config()->set('database.connections.sqlite.database',$argv[1]);
config()->set('database.connections.sqlite.foreign_key_constraints',true);
config()->set('database.connections.sqlite.busy_timeout',5000);
Illuminate\Support\Facades\DB::purge('sqlite');
Illuminate\Support\Facades\Event::listen(Illuminate\Queue\Events\JobQueueing::class,fn()=>usleep(300000));
touch($argv[2].'/ready-'.$argv[3]);$deadline=microtime(true)+5;
while(count(glob($argv[2].'/ready-*'))<2){if(microtime(true)>$deadline)throw new RuntimeException('barrier timeout');usleep(10000);}
echo json_encode(['pushed'=>app(App\Services\EdnaWorkQueue::class)->push(new App\Jobs\ProcessEdnaOrganicMenu(42))]);
PHP;
        file_put_contents($scriptFile, "<?php\n".$script);
        $flags = PHP_OS_FAMILY === 'Windows' ? ['-d', 'extension=pdo_sqlite', '-d', 'extension=sqlite3'] : [];
        $processes = [];
        foreach ([1, 2] as $index) {
            $process = new Process([PHP_BINARY, ...$flags, $scriptFile, $file, $barrier, (string) $index], base_path());
            $process->setTimeout(15)->start();
            $processes[] = $process;
        }
        $outcomes = [];
        foreach ($processes as $process) {
            $process->wait();
            $this->assertSame(0, $process->getExitCode(), $process->getOutput().$process->getErrorOutput());
            $outcomes[] = json_decode($process->getOutput(), true, 32, JSON_THROW_ON_ERROR)['pushed'];
        }
        sort($outcomes);
        expect($outcomes)->toBe([false, true]);
        $connection = DB::connection('work_queue_concurrency');
        expect($connection->table('jobs')->count())->toBe(1)->and($connection->table('edna_work_queue_keys')->count())->toBe(1);
        $connection->table('jobs')->delete();
        expect($connection->table('edna_work_queue_keys')->count())->toBe(0);
    } finally {
        foreach ($processes ?? [] as $process) {
            if ($process->isRunning()) {
                $process->stop(0.1);
            }
        }
        DB::setDefaultConnection($default);
        Schema::clearResolvedInstance('db.schema');
        DB::purge('work_queue_concurrency');
        foreach ([1, 2] as $index) {
            if (is_file($barrier.'/ready-'.$index)) {
                unlink($barrier.'/ready-'.$index);
            }
        }
        rmdir($barrier);
        if (is_file($scriptFile)) {
            unlink($scriptFile);
        }
        unlink($file);
    }
});
