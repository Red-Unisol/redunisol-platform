<?php

namespace App\Filament\Pages;

use App\Models\SiteSetting;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Forms\Components\Placeholder;
use Filament\Forms\Components\TextInput;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use UnitEnum;

class FinalizarSettingsPage extends Page
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedCheckBadge;

    protected string $view = 'filament.pages.finalizar-settings';

    protected static ?string $title = 'Página Finalizar Crédito';

    protected static ?string $navigationLabel = 'Finalizar Crédito';

    protected static string|UnitEnum|null $navigationGroup = 'Configuración';

    protected static ?int $navigationSort = 7;

    public ?array $data = [];

    public function mount(): void
    {
        $normalizeTermsUrl = static function (string $url): string {
            return $url === '/terminos-y-condiciones'
                ? '/terminos-y-condiciones.pdf'
                : $url;
        };

        $this->data = [
            // Tasas
            'finalizar_tna'          => SiteSetting::get('finalizar_tna', ''),
            'finalizar_tea'          => SiteSetting::get('finalizar_tea', ''),
            'finalizar_tnm'          => SiteSetting::get('finalizar_tnm', ''),
            'finalizar_cft'          => SiteSetting::get('finalizar_cft', ''),

            // Links legales y contacto
            'finalizar_terms_url'    => $normalizeTermsUrl(SiteSetting::get('finalizar_terms_url', '/terminos-y-condiciones.pdf')),
            'finalizar_contact_email'=> SiteSetting::get('finalizar_contact_email', ''),
            'finalizar_whatsapp_url' => SiteSetting::get('finalizar_whatsapp_url', ''),
            'finalizar_facebook_url' => SiteSetting::get('finalizar_facebook_url', ''),

            // Textos de la página
            'finalizar_heading'      => SiteSetting::get('finalizar_heading', 'Termina tu Solicitud'),
            'finalizar_subheading'   => SiteSetting::get('finalizar_subheading', 'Su préstamo será descontado de la siguiente forma:'),
            'finalizar_contact_question' => SiteSetting::get('finalizar_contact_question', '¿Tiene otra consulta para hacernos?'),
        ];

        $this->form->fill($this->data);
    }

    public function form(Schema $schema): Schema
    {
        return $schema->schema([

            Section::make('Textos de la Página')
                ->description('Textos que se muestran en la página /finalizar.')
                ->schema([
                    TextInput::make('finalizar_heading')
                        ->label('Título principal')
                        ->placeholder('Termina tu Solicitud')
                        ->columnSpanFull(),

                    TextInput::make('finalizar_subheading')
                        ->label('Subtítulo')
                        ->placeholder('Su préstamo será descontado de la siguiente forma:')
                        ->columnSpanFull(),

                    TextInput::make('finalizar_contact_question')
                        ->label('Texto de pregunta de contacto')
                        ->placeholder('¿Tiene otra consulta para hacernos?')
                        ->columnSpanFull(),
                ]),

            Section::make('Tasas Financieras')
                ->description('Estas tasas se mostrarán debajo del botón de verificación y junto al link de términos y condiciones.')
                ->schema([
                    TextInput::make('finalizar_tna')
                        ->label('Tasa Nominal Anual (TNA)')
                        ->suffix('%')
                        ->placeholder('0.00')
                        ->numeric(),

                    TextInput::make('finalizar_tea')
                        ->label('Tasa Efectiva Anual (TEA)')
                        ->suffix('%')
                        ->placeholder('0.00')
                        ->numeric(),

                    TextInput::make('finalizar_tnm')
                        ->label('Tasa Nominal Mensual (TNM)')
                        ->suffix('%')
                        ->placeholder('0.00')
                        ->numeric(),

                    TextInput::make('finalizar_cft')
                        ->label('Costo Financiero Total Efectivo Anual (CFT)')
                        ->suffix('%')
                        ->placeholder('0.00')
                        ->numeric(),
                ])
                ->columns(2),

            Section::make('Links y Contacto')
                ->description('URLs y datos de contacto que se muestran al pie de la página.')
                ->schema([
                    TextInput::make('finalizar_terms_url')
                        ->label('URL de Términos y Condiciones')
                        ->placeholder('/terminos-y-condiciones.pdf')
                        ->columnSpanFull(),

                    TextInput::make('finalizar_contact_email')
                        ->label('Email de contacto')
                        ->email()
                        ->placeholder('contacto@redunisol.com.ar')
                        ->helperText('Si se deja vacío, se usará el email de Configuración General.'),

                    TextInput::make('finalizar_whatsapp_url')
                        ->label('URL de WhatsApp')
                        ->placeholder('https://wa.me/549...')
                        ->helperText('URL completa de WhatsApp (ej: https://wa.me/5493511234567)'),

                    TextInput::make('finalizar_facebook_url')
                        ->label('URL de Facebook Messenger')
                        ->url()
                        ->placeholder('https://m.me/redunisol')
                        ->helperText('URL de Facebook Messenger'),
                ])
                ->columns(2),

            Section::make('Vista previa de la URL')
                ->description('La página /finalizar acepta los siguientes parámetros opcionales en la URL:')
                ->schema([
                    Placeholder::make('url_preview')
                        ->label('')
                        ->content('/finalizar?monto=50000&cuotas=12&nro=ABC123')
                        ->columnSpanFull(),
                ])
                ->collapsible()
                ->collapsed(),

        ])->statePath('data');
    }

    public function save(): void
    {
        $data = $this->form->getState();

        foreach ($data as $key => $value) {
            SiteSetting::set($key, $value ?? '');
        }

        Notification::make()
            ->title('Configuración de Finalizar guardada correctamente')
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
