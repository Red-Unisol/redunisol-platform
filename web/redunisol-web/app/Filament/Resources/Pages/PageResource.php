<?php

namespace App\Filament\Resources\Pages;

use App\Filament\Resources\Pages\Pages\CreatePage;
use App\Filament\Resources\Pages\Pages\EditPage;
use App\Filament\Resources\Pages\Pages\ListPages;
use App\Filament\Resources\Pages\Tables\PagesTable;
use App\Models\Page;
use BackedEnum;
use Filament\Forms\Components\Builder;
use Filament\Forms\Components\Repeater;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
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
                                        ->url()
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
                                        ->helperText('Ruta relativa o URL absoluta. Ej: /images/mutuales/logo.avif')
                                        ->url(),
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
