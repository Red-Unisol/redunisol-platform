<?php

namespace App\Filament\Pages;

use App\Support\ReportRepository;
use BackedEnum;
use Filament\Pages\Page;
use Filament\Support\Icons\Heroicon;
use Illuminate\Support\Collection;
use UnitEnum;

class ReportsPage extends Page
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedDocumentChartBar;

    protected static ?string $navigationLabel = 'Reportes';

    protected static ?string $title = 'Reportes';

    protected static string|UnitEnum|null $navigationGroup = 'Gestión';

    protected static ?int $navigationSort = 1;

    protected string $view = 'filament.pages.reports';

    public function getReports(): Collection
    {
        return app(ReportRepository::class)->all();
    }
}
