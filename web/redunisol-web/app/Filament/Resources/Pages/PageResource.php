<?php

namespace App\Filament\Resources\Pages;

use App\Filament\Resources\Pages\Pages\CreatePage;
use App\Filament\Resources\Pages\Pages\EditPage;
use App\Filament\Resources\Pages\Pages\ListPages;
use App\Filament\Resources\Pages\Tables\PagesTable;
use App\Models\Page;
use BackedEnum;
use Filament\Forms\Components\Builder;
use Filament\Schemas\Components\Fieldset;
use Filament\Forms\Components\Repeater;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Schemas\Components\Utilities\Get;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;

class PageResource extends Resource
{
    protected static ?string $model = Page::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedRectangleStack;

    public static function form(Schema $schema): Schema
    {
        return $schema->schema([
            TextInput::make('title')
                ->label('Título')
                ->required(),

            TextInput::make('slug')
                ->label('Slug')
                ->helperText('Usá "/" para la home. Ej: /nosotros, /servicios')
                ->required()
                ->unique(ignoreRecord: true),

            Fieldset::make('SEO')
                ->label('Configuración SEO')
                ->schema([
                    TextInput::make('meta_title')
                        ->label('Meta Title')
                        ->helperText('Título que aparece en buscadores (máx 60 caracteres)')
                        ->maxLength(60),

                    Textarea::make('meta_description')
                        ->label('Meta Description')
                        ->helperText('Descripción que aparece en buscadores (máx 160 caracteres)')
                        ->maxLength(160)
                        ->rows(2),

                    TextInput::make('keyword')
                        ->label('Keyword Principal')
                        ->helperText('Palabra clave objetivo para esta página'),

                    Toggle::make('index')
                        ->label('Indexar en buscadores')
                        ->helperText('Permitir que Google indexe esta página')
                        ->default(true),
                ])
                ->columns(2),

            Builder::make('sections')
                ->label('Secciones')
                ->blocks([

                    // ──────────────────────────────────────────
                    // HERO
                    // ──────────────────────────────────────────
                    Builder\Block::make('hero')
                        ->label('Hero')
                        ->icon('heroicon-o-star')
                        ->schema([
                            TextInput::make('title')
                                ->label('Título principal')
                                ->required(),

                            TextInput::make('highlight')
                                ->label('Texto resaltado')
                                ->helperText('Aparece en verde debajo del título.')
                                ->required(),

                            Textarea::make('description')
                                ->label('Descripción')
                                ->rows(3),

                            TextInput::make('socialProof.prefix')
                                ->label('Prueba social — número')
                                ->helperText('Ej: 50.000+'),

                            TextInput::make('socialProof.suffix')
                                ->label('Prueba social — texto')
                                ->helperText('Ej: créditos otorgados en más de una década'),
                        ]),

                    // ──────────────────────────────────────────
                    // SERVICES
                    // ──────────────────────────────────────────
                    Builder\Block::make('services')
                        ->label('Servicios')
                        ->icon('heroicon-o-banknotes')
                        ->schema([
                            TextInput::make('title')
                                ->label('Título de sección')
                                ->required(),

                            Textarea::make('description')
                                ->label('Descripción')
                                ->rows(2),

                            Repeater::make('items')
                                ->label('Líneas de préstamos')
                                ->schema([
                                    TextInput::make('text')
                                        ->label('Nombre de la línea')
                                        ->required(),

                                    Select::make('icon')
                                        ->label('Ícono')
                                        ->options([
                                            'eyeglasses'          => 'Anteojos (Jubilados)',
                                            'buildings'           => 'Edificios (Emp. Públicos)',
                                            'police-car'          => 'Patrullero (Policías)',
                                            'chalkboard-teacher'  => 'Pizarrón (Docentes)',
                                            'book-open-text'      => 'Libro (UNC)',
                                            'hand-heart'          => 'Mano corazón (Pensionados)',
                                        ])
                                        ->searchable(),

                                    TextInput::make('href')
                                        ->label('Enlace (href)')
                                        ->helperText('Ej: /prestamos-para-policias — dejalo vacío si todavía no tiene página.')
                                        ->nullable(),
                                ])
                                ->defaultItems(1)
                                ->reorderable()
                                ->collapsible(),

                            Textarea::make('note')
                                ->label('Nota al pie')
                                ->rows(2),
                        ]),

                    // ──────────────────────────────────────────
                    // ABOUT
                    // ──────────────────────────────────────────
                    Builder\Block::make('about')
                        ->label('Sobre nosotros')
                        ->icon('heroicon-o-information-circle')
                        ->schema([
                            TextInput::make('title')
                                ->label('Título de sección')
                                ->required(),

                            Textarea::make('description')
                                ->label('Descripción')
                                ->rows(3),

                            TextInput::make('extra')
                                ->label('Dato destacado')
                                ->helperText('Ej: +12 años, +50.000 créditos otorgados'),

                            Repeater::make('mutuales')
                                ->label('Mutuales')
                                ->schema([
                                    TextInput::make('title')
                                        ->label('Nombre de la mutual'),

                                    TextInput::make('image')
                                        ->label('URL de imagen')
                                        ->helperText('Ruta relativa o URL absoluta. Ej: /images/mutuales/logo.avif'),
                                ])
                                ->defaultItems(0)
                                ->reorderable()
                                ->collapsible(),
                        ]),

                    // ──────────────────────────────────────────
                    // FAQS
                    // ──────────────────────────────────────────
                    Builder\Block::make('faqs')
                        ->label('Preguntas frecuentes')
                        ->icon('heroicon-o-question-mark-circle')
                        ->schema([
                            TextInput::make('badge')
                                ->label('Etiqueta del badge')
                                ->helperText('Ej: Preguntas y respuestas frecuentes'),

                            Textarea::make('description')
                                ->label('Descripción')
                                ->helperText('Podés usar **texto** para negrita.')
                                ->rows(2),

                            TextInput::make('cta')
                                ->label('Texto del botón CTA')
                                ->helperText('Ej: Comenzar hoy'),

                            Repeater::make('categories')
                                ->label('Categorías')
                                ->schema([
                                    TextInput::make('title')
                                        ->label('Nombre de la categoría')
                                        ->required(),

                                    Repeater::make('items')
                                        ->label('Preguntas')
                                        ->schema([
                                            TextInput::make('q')
                                                ->label('Pregunta')
                                                ->required(),

                                            Textarea::make('a')
                                                ->label('Respuesta')
                                                ->rows(3)
                                                ->required(),
                                        ])
                                        ->defaultItems(1)
                                        ->reorderable()
                                        ->collapsible(),
                                ])
                                ->defaultItems(1)
                                ->reorderable()
                                ->collapsible(),
                        ]),

                    // ──────────────────────────────────────────
                    // CONVENIOS
                    // ──────────────────────────────────────────
                    Builder\Block::make('convenios')
                        ->label('Convenios / Provincias')
                        ->icon('heroicon-o-building-library')
                        ->schema([
                            TextInput::make('title')
                                ->label('Título')
                                ->default('Convenios disponibles'),
                            Repeater::make('items')
                                ->label('Items')
                                ->schema([
                                    TextInput::make('name')
                                        ->label('Nombre')
                                        ->required(),
                                    TextInput::make('detail')
                                        ->label('Detalle')
                                        ->helperText('Ej: Cobro por: Bancor según convenio')
                                        ->nullable(),
                                    TextInput::make('href')
                                        ->label('Enlace a subpágina')
                                        ->helperText('Ej: /prestamos-para-policias/policia-cordoba — Opcional')
                                        ->nullable(),
                                ])
                                ->defaultItems(1)
                                ->reorderable()
                                ->collapsible(),
                        ]),

                    // ──────────────────────────────────────────
                    // REQUISITOS
                    // ──────────────────────────────────────────
                    Builder\Block::make('requisitos')
                        ->label('Requisitos')
                        ->icon('heroicon-o-clipboard-document-check')
                        ->schema([
                            TextInput::make('title')
                                ->label('Título')
                                ->default('Requisitos'),
                            Repeater::make('items')
                                ->label('Requisitos')
                                ->schema([
                                    TextInput::make('text')
                                        ->label('Requisito')
                                        ->required(),
                                ])
                                ->defaultItems(1)
                                ->reorderable(),
                        ]),

                    // ──────────────────────────────────────────
                    // TESTIMONIOS
                    // ──────────────────────────────────────────
                    Builder\Block::make('testimonios')
                        ->label('Testimonios')
                        ->icon('heroicon-o-chat-bubble-left-right')
                        ->schema([
                            TextInput::make('title')
                                ->label('Título')
                                ->default('Lo que dicen nuestros clientes'),
                            Repeater::make('items')
                                ->label('Testimonios')
                                ->schema([
                                    Textarea::make('quote')
                                        ->label('Testimonio')
                                        ->required()
                                        ->rows(3),
                                    TextInput::make('name')
                                        ->label('Nombre y apellido'),
                                    TextInput::make('role')
                                        ->label('Cargo / Profesión'),
                                ])
                                ->defaultItems(1)
                                ->reorderable()
                                ->collapsible(),
                        ]),

                    // ──────────────────────────────────────────
                    // FORM
                    // ──────────────────────────────────────────
                    Builder\Block::make('form')
                        ->label('Formulario de solicitud')
                        ->icon('heroicon-o-document-text')
                        ->schema([

                            Fieldset::make('Paso 1 — Datos personales')
                                ->schema([
                                    Toggle::make('cuil.enabled')
                                        ->label('CUIL habilitado')
                                        ->default(true)
                                        ->inline(false),
                                    TextInput::make('cuil.label')
                                        ->label('Label del campo')
                                        ->default('CUIL'),

                                    Toggle::make('email.enabled')
                                        ->label('Email habilitado')
                                        ->default(true)
                                        ->inline(false),
                                    TextInput::make('email.label')
                                        ->label('Label del campo')
                                        ->default('Email'),

                                    Toggle::make('celular.enabled')
                                        ->label('Celular habilitado')
                                        ->default(true)
                                        ->inline(false),
                                    TextInput::make('celular.label')
                                        ->label('Label del campo')
                                        ->default('Celular / WhatsApp'),

                                    Toggle::make('terminos.enabled')
                                        ->label('Términos y Condiciones habilitado')
                                        ->default(true)
                                        ->inline(false),
                                    TextInput::make('terminos.label')
                                        ->label('Texto del checkbox')
                                        ->default('Acepto los Términos y Condiciones y la Política de Privacidad'),
                                ])
                                ->columns(2),

                            Fieldset::make('Paso 2 — Recibo de sueldo')
                                ->schema([
                                    Toggle::make('recibo.enabled')
                                        ->label('Paso habilitado')
                                        ->default(true)
                                        ->inline(false),
                                    TextInput::make('recibo.label')
                                        ->label('Título del paso')
                                        ->default('Subí tu recibo de sueldo'),
                                ])
                                ->columns(2),

                            Fieldset::make('Paso 3 — Provincia')
                                ->schema([
                                    Toggle::make('provincia.enabled')
                                        ->label('Paso habilitado')
                                        ->default(true)
                                        ->live()
                                        ->inline(false),
                                    Select::make('provincia.defaultValue')
                                        ->label('Provincia por defecto')
                                        ->helperText('Se envía automáticamente cuando el paso está deshabilitado.')
                                        ->options([
                                            'Córdoba'    => 'Córdoba',
                                            'Catamarca'  => 'Catamarca',
                                            'La Rioja'   => 'La Rioja',
                                            'Santa Fe'   => 'Santa Fe',
                                            'Jujuy'      => 'Jujuy',
                                            'Especifica' => 'Especifica',
                                        ])
                                        ->placeholder('Seleccioná una provincia')
                                        ->hidden(fn (Get $get): bool => (bool) $get('provincia.enabled'))
                                        ->columnSpanFull(),
                                ])
                                ->columns(2),

                            Fieldset::make('Paso 4 — Situación laboral y banco')
                                ->schema([
                                    Toggle::make('situacionLaboral.enabled')
                                        ->label('Situación laboral habilitada')
                                        ->default(true)
                                        ->live()
                                        ->inline(false),
                                    TextInput::make('situacionLaboral.label')
                                        ->label('Label del campo')
                                        ->default('¿Cuál es su situación laboral?')
                                        ->hidden(fn (Get $get): bool => ! (bool) $get('situacionLaboral.enabled')),
                                    Select::make('situacionLaboral.defaultValue')
                                        ->label('Situación laboral por defecto')
                                        ->helperText('Se envía automáticamente cuando el campo está deshabilitado.')
                                        ->options([
                                            'Empleado Publico Provincial'      => 'Empleado Público Provincial',
                                            'Empleado Publico Municipal'       => 'Empleado Público Municipal',
                                            'Empleado publico Nacional'        => 'Empleado Público Nacional',
                                            'Empleado Privado'                 => 'Empleado Privado',
                                            'Policia'                          => 'Policía',
                                            'Jubilado Nacional'                => 'Jubilado Nacional',
                                            'Jubilado Provincial'              => 'Jubilado Provincial',
                                            'Jubilado Municipal'               => 'Jubilado Municipal',
                                            'Autonomo/Independiente'           => 'Autónomo / Independiente',
                                            'Monotributista'                   => 'Monotributista',
                                            'Pensionado'                       => 'Pensionado',
                                            'Beneficiario de Plan Social'      => 'Beneficiario de Plan Social',
                                            'Jubilado/Pensionado FUERA DE USO' => 'Jubilado/Pensionado (fuera de uso)',
                                            'Docente'                          => 'Docente',
                                        ])
                                        ->placeholder('Seleccioná una situación laboral')
                                        ->hidden(fn (Get $get): bool => (bool) $get('situacionLaboral.enabled'))
                                        ->columnSpanFull(),

                                    Toggle::make('banco.enabled')
                                        ->label('Banco habilitado')
                                        ->default(true)
                                        ->live()
                                        ->inline(false),
                                    TextInput::make('banco.label')
                                        ->label('Label del campo')
                                        ->default('¿Cuál es su banco de cobro?')
                                        ->hidden(fn (Get $get): bool => ! (bool) $get('banco.enabled')),
                                    Select::make('banco.defaultValue')
                                        ->label('Banco por defecto')
                                        ->helperText('Se envía automáticamente cuando el campo está deshabilitado.')
                                        ->options([
                                            'BANCO DE LA PROVINCIA DE CORDOBA S.A.'        => 'Bancor',
                                            'BANCO DE LA NACION ARGENTINA'                 => 'Banco Nación',
                                            'BANCO DE LA PAMPA SOCIEDAD DE ECONOMÍA'       => 'Banco de La Pampa',
                                            'BANCO PROVINCIA DEL NEUQUÉN SOCIEDAD ANÓNIMA' => 'Banco Neuquén',
                                            'BANCO PATAGONIA S.A.'                         => 'Banco Patagonia',
                                            'BBVA BANCO FRANCES S.A.'                      => 'BBVA Frances',
                                            'BANCO SANTANDER RIO S.A.'                     => 'Santander Río',
                                            'BANCO DEL CHUBUT S.A.'                        => 'Banco Chubut',
                                            'HSBC BANK ARGENTINA S.A.'                     => 'HSBC',
                                            'BANCO ITAU ARGENTINA S.A.'                    => 'Itaú',
                                            'BANCO MACRO S.A.'                             => 'Macro',
                                            'BANCO DE GALICIA Y BUENOS AIRES S.A.U.'       => 'Galicia',
                                            'BANCO DE LA PROVINCIA DE BUENOS AIRES'        => 'Banco Provincia',
                                            'BRUBANK S.A.U.'                               => 'Brubank',
                                            'BANCO CREDICOOP COOPERATIVO LIMITADO'         => 'Credicoop',
                                            'BANCO SUPERVIELLE S.A.'                       => 'Supervielle',
                                            'BANCO DE LA CIUDAD DE BUENOS AIRES'           => 'Banco Ciudad',
                                            'BANCO HIPOTECARIO S.A.'                       => 'Hipotecario',
                                            'NARANJA DIGITAL COMPAÑÍA FINANCIERA S.A.'     => 'Naranja Digital',
                                            'Otros'                                         => 'Otros',
                                        ])
                                        ->searchable()
                                        ->placeholder('Seleccioná un banco')
                                        ->hidden(fn (Get $get): bool => (bool) $get('banco.enabled'))
                                        ->columnSpanFull(),
                                ])
                                ->columns(2),

                        ]),

                ])
                ->columnSpanFull()
                ->reorderable()
                ->collapsible(),
        ]);
    }

    public static function table(Table $table): Table
    {
        return PagesTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index'  => ListPages::route('/'),
            'create' => CreatePage::route('/create'),
            'edit'   => EditPage::route('/{record}/edit'),
        ];
    }
}
