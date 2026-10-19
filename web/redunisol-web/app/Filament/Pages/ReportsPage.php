<?php

namespace App\Filament\Pages;

use App\Support\ReportCatalog;
use App\Support\ReportRegenerator;
use App\Support\ReportRepository;
use BackedEnum;
use Filament\Facades\Filament;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Support\Icons\Heroicon;
use Illuminate\Http\Client\ConnectionException;
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

    public function getReportGroups(): Collection
    {
        $regenerator = app(ReportRegenerator::class);

        return app(ReportCatalog::class)->groups(app(ReportRepository::class)->all())
            ->map(fn (array $group): array => [
                ...$group,
                'regeneration' => $regenerator->status($group['key']),
                'regeneration_available' => $group['regenerable'] && $regenerator->configured(),
            ]);
    }

    public function regenerate(string $key): void
    {
        abort_unless(auth()->user()?->canAccessPanel(Filament::getPanel('admin')), 403);
        abort_unless(app(ReportCatalog::class)->definition($key), 404);

        try {
            $state = app(ReportRegenerator::class)->start($key);
            Notification::make()->title($state['state'] === 'UNKNOWN'
                ? 'Todavía no se pudo confirmar el inicio'
                : 'Regeneración en curso')
                ->body('El archivo descargable se actualizará cuando termine su publicación. Algunos informes pueden demorar varias horas.')
                ->info()->send();
        } catch (\RuntimeException|ConnectionException) {
            Notification::make()->title('No se pudo confirmar la regeneración')
                ->body('Esperá dos minutos antes de volver a intentar. La descarga anterior sigue disponible.')
                ->danger()->send();
        }
    }
}
