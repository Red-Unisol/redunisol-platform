<?php

it('stores and displays regulator logos on the public disk', function () {
    $resource = file_get_contents(app_path('Filament/Resources/Regulators/RegulatorResource.php'));

    preg_match(
        "/FileUpload::make\('logo_path'\)(?<configuration>.*?)->columnSpanFull\(\),/s",
        $resource,
        $upload,
    );

    preg_match(
        "/ImageColumn::make\('logo_path'\)(?<configuration>.*?)->defaultImageUrl\(fn \(\) => null\),/s",
        $resource,
        $column,
    );

    expect($upload['configuration'] ?? null)
        ->not->toBeNull()
        ->toContain("->disk('public')")
        ->toContain("->visibility('public')")
        ->toContain("->directory('regulators')");

    expect($column['configuration'] ?? null)
        ->not->toBeNull()
        ->toContain("->disk('public')")
        ->toContain("->visibility('public')");
});
