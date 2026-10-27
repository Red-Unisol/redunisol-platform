<?php

use App\Services\EdnaIntakePilot;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

// Local concurrency fixture. Only an isolated SQLite file and synthetic identities.
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$input = json_decode(stream_get_contents(STDIN), true, 8, JSON_THROW_ON_ERROR);
config()->set('app.key', 'base64:'.base64_encode(str_repeat('i', 32)));
config()->set('edna.intake_pilot_id', EdnaIntakePilot::DEFAULT_NAME);
config()->set('database.connections.pilot_race', ['driver' => 'sqlite', 'database' => $input['database'],
    'foreign_key_constraints' => true, 'busy_timeout' => 10000]);
DB::setDefaultConnection('pilot_race');
DB::statement('PRAGMA busy_timeout=10000');
echo "ready\n";
flush();
$deadline = microtime(true) + 75;
while (! is_file($input['gate'])) {
    if (microtime(true) > $deadline) {
        exit(2);
    }
    usleep(10000);
    clearstatcache(true, $input['gate']);
}
$admission = (new EdnaIntakePilot)->reserve('2423', $input['phone'], '999000111222333', true);
echo json_encode(['admission_id' => $admission?->id, 'slot' => $admission?->slot]).PHP_EOL;
