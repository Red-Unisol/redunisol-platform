<?php

namespace App\Filament\Pages;

use App\Support\WhatsAppOutOfHoursSettings;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\Repeater;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\TimePicker;
use Filament\Forms\Components\Toggle;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Illuminate\Validation\ValidationException;
use UnitEnum;

class WhatsAppOutOfHoursPage extends Page
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedClock;

    protected static ?string $navigationLabel = 'WhatsApp fuera de horario';

    protected static ?string $title = 'WhatsApp fuera de horario — Ventas';

    protected static ?string $slug = 'whatsapp-fuera-de-horario';

    protected static string|UnitEnum|null $navigationGroup = 'Configuración';

    protected string $view = 'filament.pages.whatsapp-out-of-hours';

    public ?array $data = [];

    public function mount(WhatsAppOutOfHoursSettings $settings): void
    {
        $data = $settings->get();
        $data['holidays'] = array_map(fn ($day) => ['date' => $day], $data['holidays']);
        $this->form->fill($data);
    }

    public function form(Schema $schema): Schema
    {
        return $schema->schema([
            Section::make('Avisos de Ventas')
                ->description('Activar al coordinar el reemplazo del aviso de Bitrix. Los recorridos automáticos no reciben este aviso.')
                ->schema([
                    Toggle::make('enabled')->label('Habilitar avisos')->inline(false)
                        ->disabled(fn () => ! config('edna.out_of_hours_enabled'))
                        ->helperText(fn () => config('edna.out_of_hours_enabled') ? 'Activar al reemplazar el aviso de Bitrix.' : 'Los envíos todavía no están habilitados. Podés preparar textos y horarios.'),
                    TextInput::make('timezone')->label('Zona horaria')->required(),
                    TimePicker::make('open')->label('Inicio de atención')->seconds(false)->format('H:i')->required(),
                    TimePicker::make('close')->label('Fin de atención')->seconds(false)->format('H:i')->required(),
                    Select::make('weekdays')->label('Días de atención')->multiple()->required()->options([
                        1 => 'Lunes', 2 => 'Martes', 3 => 'Miércoles', 4 => 'Jueves', 5 => 'Viernes', 6 => 'Sábado', 7 => 'Domingo',
                    ]),
                    Repeater::make('holidays')->label('Feriados y cierres excepcionales')->schema([
                        DatePicker::make('date')->label('Fecha')->required(),
                    ])->defaultItems(0)->addActionLabel('Agregar fecha')->columnSpanFull(),
                ])->columns(2),
            Section::make('Textos sin enlaces')
                ->description('Variables: {saludo}, {asesor}, {proxima_apertura} y {horario}. Los nombres se omiten cuando no hay una identificación segura.')
                ->schema([
                    Textarea::make('managed_text')->label('Persona en gestión')->required()->maxLength(2000)->rows(4),
                    Textarea::make('general_text')->label('Aviso general')->required()->maxLength(2000)->rows(4),
                ]),
        ])->statePath('data');
    }

    public function save(WhatsAppOutOfHoursSettings $settings): void
    {
        $data = $this->form->getState();
        $data['holidays'] = array_column($data['holidays'] ?? [], 'date');
        try {
            $settings->save($data);
        } catch (ValidationException $e) {
            throw ValidationException::withMessages(collect($e->errors())->mapWithKeys(fn ($messages, $key) => ['data.'.$key => $messages])->all());
        }
        Notification::make()->title('Configuración guardada')->body('Los nuevos avisos usarán estos textos y horarios.')->success()->send();
    }

    protected function getHeaderActions(): array
    {
        return [Action::make('save')->label('Guardar cambios')->action('save')];
    }
}
