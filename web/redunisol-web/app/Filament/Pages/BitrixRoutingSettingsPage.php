<?php

namespace App\Filament\Pages;

use App\Services\CommercialChatStatus;
use App\Support\BitrixRoutingConfig;
use App\Support\BitrixSellerRegistry;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Facades\Filament;
use Filament\Forms\Components\Repeater;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Toggle;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Illuminate\Validation\ValidationException;
use Livewire\Attributes\Locked;
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

    #[Locked]
    public int $catalogRevision = 0;

    public string $chatLookup = '';

    #[Locked]
    public ?array $chatStatus = null;

    public function lookupChat(CommercialChatStatus $lookup): void
    {
        abort_unless(auth()->user()?->canAccessPanel(Filament::getPanel('admin')), 403);
        $this->chatStatus = null;
        $this->validate(['chatLookup' => ['required', 'regex:/^[1-9][0-9]{0,14}$/D']], [
            'chatLookup.required' => 'Ingresá el número de chat.',
            'chatLookup.regex' => 'Usá el ID numérico del chat de Bitrix.',
        ]);
        try {
            $this->chatStatus = $lookup->lookup((int) $this->chatLookup);
        } catch (\Throwable) {
            $this->addError('chatLookup', 'No se pudo verificar la sesión de VENTAS en Bitrix.');
        }
    }

    public function mount(BitrixRoutingConfig $config): void
    {
        $this->catalogRevision = app(BitrixSellerRegistry::class)->revision();
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
        $state = $this->form->getState();
        try {
            $config->save($state, $this->catalogRevision);
        } catch (ValidationException) {
            Notification::make()->warning()->title('Cambió la lista de vendedores')
                ->body('Recargá la página y revisá las líneas antes de guardar.')->send();

            return;
        }

        Notification::make()
            ->title('Distribución actualizada')
            ->body('Los cambios se aplicarán en la próxima ejecución de Kestra.')
            ->success()
            ->send();
    }

    protected function getHeaderActions(): array
    {
        return [
            Action::make('sellers')->label('Vendedores habilitados')->url(BitrixSellersPage::getUrl())->color('gray'),
            Action::make('save')
                ->label('Guardar cambios')
                ->icon('heroicon-o-check')
                ->action('save'),
        ];
    }
}
