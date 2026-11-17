<?php

namespace App\Filament\Pages;

use App\Models\BitrixRoutingSeller;
use App\Services\BitrixUserDirectory;
use App\Support\BitrixSellerRegistry;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Facades\Filament;
use Filament\Forms\Components\Select;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\View\View;
use Livewire\Attributes\Locked;
use RuntimeException;
use UnitEnum;

class BitrixSellersPage extends Page
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedUserGroup;

    protected static ?string $navigationLabel = 'Vendedores habilitados';

    protected static ?string $title = 'Vendedores habilitados';

    protected static ?string $slug = 'vendedores-bitrix';

    protected static string|UnitEnum|null $navigationGroup = 'Configuración';

    protected static ?int $navigationSort = 6;

    protected string $view = 'filament.pages.bitrix-sellers';

    public ?array $data = [];

    #[Locked]
    public array $bitrixUsers = [];

    #[Locked]
    public bool $directoryAvailable = false;

    #[Locked]
    public int $catalogRevision = 0;

    public static function canAccess(): bool
    {
        return auth()->user()?->canAccessPanel(Filament::getPanel('admin')) ?? false;
    }

    public function mount(BitrixSellerRegistry $registry): void
    {
        $this->catalogRevision = $registry->revision();
        $this->form->fill(['seller_ids' => $registry->enabledIds()]);
        $this->loadDirectory();
    }

    public function form(Schema $schema): Schema
    {
        return $schema->schema([
            Section::make('Usuarios de Bitrix')
                ->description('Buscá por nombre o correo y seleccioná las cuentas que podrán recibir líneas.')
                ->schema([
                    Select::make('seller_ids')
                        ->label('Vendedores habilitados')
                        ->multiple()->searchable()->preload()->live()
                        ->options(fn (): array => $this->userOptions())
                        ->disableOptionWhen(fn (string $value): bool => ! ($this->bitrixUsers[(int) $value]['active'] ?? false))
                        ->optionsLimit(5000)
                        ->placeholder('Buscar por nombre o correo')
                        ->searchPrompt('Buscá por nombre o correo')
                        ->noSearchResultsMessage('No se encontraron usuarios.')
                        ->helperText('Las cuentas inactivas no se pueden habilitar. Agregar una cuenta no le asigna líneas automáticamente.'),
                ]),
        ])->statePath('data');
    }

    public function refreshDirectory(): void
    {
        $this->loadDirectory(fresh: true);
    }

    private function loadDirectory(bool $fresh = false): void
    {
        try {
            $this->bitrixUsers = app(BitrixUserDirectory::class)->users($fresh);
            $this->directoryAvailable = true;
        } catch (RuntimeException) {
            $this->bitrixUsers = [];
            $this->directoryAvailable = false;
        }
    }

    private function userOptions(): array
    {
        $options = [];
        foreach ($this->bitrixUsers as $id => $user) {
            $options[$id] = $user['name'].' — '.($user['email'] ?: 'Sin correo disponible').($user['active'] ? '' : ' (inactiva)');
        }
        foreach (BitrixRoutingSeller::query()->where('enabled', true)->get() as $seller) {
            $options[$seller->bitrix_user_id] ??= $seller->label().' (no disponible en Bitrix)';
        }

        return $options;
    }

    public function save(BitrixSellerRegistry $registry): void
    {
        try {
            $registry->save($this->form->getState()['seller_ids'] ?? [], $this->catalogRevision, auth()->user());
        } catch (RuntimeException) {
            Notification::make()->danger()->title('No se pudo verificar Bitrix')
                ->body('La lista actual se conserva. Actualizá los usuarios e intentá nuevamente.')->send();

            return;
        }
        $this->catalogRevision = $registry->revision();
        $this->form->fill(['seller_ids' => $registry->enabledIds()]);
        Notification::make()->success()->title('Vendedores actualizados')
            ->body('Las cuentas retiradas quedaron pausadas en sus líneas. Las negociaciones existentes conservan su responsable.')->send();
    }

    protected function getHeaderActions(): array
    {
        return [
            Action::make('routing')->label('Asignar líneas')->url(BitrixRoutingSettingsPage::getUrl())->color('gray'),
            Action::make('refreshDirectory')->label('Actualizar desde Bitrix')->action('refreshDirectory')->color('gray'),
            Action::make('save')->label('Guardar cambios')->action(fn (BitrixSellerRegistry $registry) => $this->save($registry))->disabled(fn (): bool => ! $this->directoryAvailable)
                ->requiresConfirmation()->modalHeading('Actualizar vendedores habilitados')
                ->modalDescription('Revisá las cuentas y las líneas afectadas antes de confirmar.')->modalCancelActionLabel('Cancelar')
                ->modalSubmitActionLabel('Confirmar cambios')
                ->modalContent(fn (): View => view('filament.pages.bitrix-sellers-confirmation', [
                    'impact' => app(BitrixSellerRegistry::class)->disablingImpact($this->data['seller_ids'] ?? []),
                ])),
        ];
    }
}
