<?php

namespace App\Filament\Pages;

use UnitEnum;
use App\Models\SiteSetting;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Forms\Components\Section;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;

class SiteSettingsPage extends Page
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedCog6Tooth;

    protected string $view = 'filament.pages.site-settings';

    protected static ?string $title = 'Configuración del Sitio';

    protected static ?string $navigationLabel = 'Configuración General';

    protected static string|UnitEnum|null $navigationGroup = 'Configuración';

    protected static ?int $navigationSort = 10;

    public ?array $data = [];

    public function mount(): void
    {
        $this->data = [
            'legal_disclaimer'         => SiteSetting::get('legal_disclaimer', ''),
            'organization_name'        => SiteSetting::get('organization_name', 'Red Unisol'),
            'organization_description' => SiteSetting::get('organization_description', ''),
            'contact_email'            => SiteSetting::get('contact_email', ''),
            'contact_phone'            => SiteSetting::get('contact_phone', ''),
            'contact_address'          => SiteSetting::get('contact_address', ''),
            'facebook_url'             => SiteSetting::get('facebook_url', ''),
            'instagram_url'            => SiteSetting::get('instagram_url', ''),
            'linkedin_url'             => SiteSetting::get('linkedin_url', ''),
            'youtube_url'              => SiteSetting::get('youtube_url', ''),
        ];

        $this->form->fill($this->data);
    }

    public function form(Schema $schema): Schema
    {
        return $schema->schema([

            Section::make('Disclaimer Legal')
                ->description('Texto legal que aparece en el footer del sitio (tasas, condiciones, etc.)')
                ->schema([
                    Textarea::make('legal_disclaimer')
                        ->label('Texto del Disclaimer')
                        ->rows(10)
                        ->columnSpanFull(),
                ]),

            Section::make('Información de la Organización')
                ->schema([
                    TextInput::make('organization_name')
                        ->label('Nombre de la organización')
                        ->default('Red Unisol'),

                    TextInput::make('contact_email')
                        ->label('Email de contacto')
                        ->email(),

                    TextInput::make('contact_phone')
                        ->label('Teléfono de contacto'),

                    TextInput::make('contact_address')
                        ->label('Dirección')
                        ->columnSpanFull(),

                    Textarea::make('organization_description')
                        ->label('Descripción')
                        ->rows(3)
                        ->columnSpanFull(),
                ])
                ->columns(2),

            Section::make('Redes Sociales')
                ->schema([
                    TextInput::make('facebook_url')
                        ->label('Facebook URL')
                        ->url()
                        ->prefix('https://'),

                    TextInput::make('instagram_url')
                        ->label('Instagram URL')
                        ->url()
                        ->prefix('https://'),

                    TextInput::make('linkedin_url')
                        ->label('LinkedIn URL')
                        ->url()
                        ->prefix('https://'),

                    TextInput::make('youtube_url')
                        ->label('YouTube URL')
                        ->url()
                        ->prefix('https://'),
                ])
                ->columns(2),

        ])->statePath('data');
    }

    public function save(): void
    {
        $data = $this->form->getState();

        foreach ($data as $key => $value) {
            SiteSetting::set($key, $value ?? '');
        }

        Notification::make()
            ->title('Configuración guardada correctamente')
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
