<?php

use App\Support\ReportRepository;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

uses(TestCase::class);

afterEach(function () {
    $directory = storage_path('framework/testing/reports');

    if (is_dir($directory)) {
        File::deleteDirectory($directory);
    }
});

test('it lists only supported report files ordered by modification date', function () {
    $directory = storage_path('framework/testing/reports');
    mkdir($directory.'/marketing/historico', 0777, true);
    file_put_contents($directory.'/marketing/historico/anterior.xlsx', 'old');
    touch($directory.'/marketing/historico/anterior.xlsx', 1000);
    file_put_contents($directory.'/marketing/ultimo.xlsx', 'new');
    touch($directory.'/marketing/ultimo.xlsx', 2000);
    file_put_contents($directory.'/marketing/secreto.txt', 'hidden');
    config(['filesystems.reports_path' => $directory]);

    $reports = app(ReportRepository::class)->all();

    expect($reports)->toHaveCount(2)
        ->and($reports->pluck('name')->all())->toBe(['ultimo.xlsx', 'anterior.xlsx'])
        ->and($reports->first()['path'])->toBe('marketing/ultimo.xlsx');
});

test('it rejects files outside the reports directory', function () {
    $directory = storage_path('framework/testing/reports');
    mkdir($directory, 0777, true);
    config(['filesystems.reports_path' => $directory]);

    app(ReportRepository::class)->resolve('../app.php');
})->throws(RuntimeException::class);
