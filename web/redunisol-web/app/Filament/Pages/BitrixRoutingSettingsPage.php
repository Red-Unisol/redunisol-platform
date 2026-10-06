<?php

namespace App\Filament\Pages;

use App\Support\BitrixRoutingConfig;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Forms\Components\Repeater;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Toggle;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use UnitEnum;

class BitrixRoutingSettingsPage extends Page
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedUsers;

    protected static ?string $navigationLabel = 'Distribución Bitrix';

    protected static ?string $title = 'Distribución Bitrix';

    protected static ?string $slug = 'distribucion-bitrix';

    protected static string|UnitEnum|null $navigationGroup = 'Configuración';

    protected static ?int $navigationSort = 5;

    protected string $view = 'filament.pages.bitrix-routing-settings';

    public ?array $data = [];

    public function mount(BitrixRoutingConfig $config): void
    {
        $this->form->fill($config->forForm());
    }

    public function form(Schema $schema): Schema
    {
        $options = BitrixRoutingConfig::sellerOptions();

        return $schema
            ->schema(collect(BitrixRoutingConfig::BUCKETS)
                ->map(function (array $bucket, string $key) use ($options): Section {
                    return Section::make($bucket['label'])
                        ->description($bucket['description'])
                        ->schema([
                            Repeater::make($key)
                                ->hiddenLabel()
                                ->schema([
                                    Select::make('user_id')
                                        ->label('Vendedor')
                                        ->options($options)
                                        ->searchable()
                                        ->required()
                                        ->disableOptionsWhenSelectedInSiblingRepeaterItems(),
                                    Toggle::make('paused')
                                        ->label('Pausado')
                                        ->helperText('No recibirá nuevas asignaciones.')
                                        ->inline(false),
                                ])
                                ->columns(2)
                                ->reorderableWithButtons()
                                ->addActionLabel('Agregar vendedor')
                                ->itemLabel(fn (array $state): string => $options[(int) ($state['user_id'] ?? 0)] ?? 'Vendedor'),
                        ]);
                })
                ->values()
                ->all())
            ->statePath('data');
    }

    public function save(BitrixRoutingConfig $config): void
    {
        $config->save($this->form->getState());

        Notification::make()
            ->title('Distribución actualizada')
            ->body('Los cambios se aplicarán en la próxima ejecución de Kestra.')
            ->success()
            ->send();
    }

    protected function getHeaderActions(): array
    {
        return [
            Action::make('save')
                ->label('Guardar cambios')
                ->icon('heroicon-o-check')
                ->action('save'),
        ];
    }
}
