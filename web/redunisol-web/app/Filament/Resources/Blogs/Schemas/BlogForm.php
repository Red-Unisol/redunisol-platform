<?php

namespace App\Filament\Resources\Blogs\Schemas;

use App\Models\Category;
use App\Models\User;
use Filament\Forms\Components\DateTimePicker;
use Filament\Forms\Components\FileUpload;
use Filament\Forms\Components\RichEditor;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\Toggle;
use Filament\Schemas\Schema;
use Filament\Schemas\Components\Section;
use Filament\Forms\Components\Hidden;

class BlogForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Información principal')
                    ->schema([
                        Hidden::make('author_id')
                            ->default(auth()->id()),
                        TextInput::make('title')
                            ->label('Título')
                            ->required()
                            ->maxLength(255)
                            ->live(onBlur: true)
                            ->afterStateUpdated(function (string $state, callable $set) {
                                $set('slug', \Illuminate\Support\Str::slug($state));
                            }),

                        TextInput::make('slug')
                            ->label('Slug')
                            ->required()
                            ->unique(ignoreRecord: true)
                            ->helperText('Se genera automáticamente desde el título. Ej: prestamos-para-jubilados'),

                        TextInput::make('author_display')
                            ->label('Autor')
                            ->default('Red Unisol')
                            ->required()
                            ->maxLength(255),

                        Select::make('categories')
                            ->label('Categorías')
                            ->relationship('categories', 'name')
                            ->multiple()
                            ->searchable()
                            ->preload()
                            ->createOptionForm([
                                TextInput::make('name')
                                    ->label('Nombre')
                                    ->required()
                                    ->maxLength(255)
                                    ->live(onBlur: true)
                                    ->afterStateUpdated(fn (string $state, callable $set) =>
                                        $set('slug', \Illuminate\Support\Str::slug($state))
                                    ),
                                TextInput::make('slug')
                                    ->label('Slug')
                                    ->required(),
                            ]),

                        DateTimePicker::make('published_at')
                            ->label('Fecha de publicación')
                            ->helperText('Dejá vacío para guardar como borrador.')
                            ->nullable(),

                        FileUpload::make('image')
                            ->label('Imagen destacada')
                            ->image()
                            ->directory('blogs')
                            ->imageEditor()
                            ->nullable(),
                    ])
                    ->columns(2),

                Section::make('Contenido')
                    ->schema([
                        Textarea::make('excerpt')
                            ->label('Resumen / Extracto')
                            ->helperText('Breve descripción que aparece en las listas de blog.')
                            ->rows(3)
                            ->nullable()
                            ->columnSpanFull(),

                        RichEditor::make('content')
                            ->label('Contenido')
                            ->helperText('Para tablas: insertá HTML directamente usando el modo fuente (</>).')
                            ->required()
                            ->toolbarButtons([
                                'bold', 'italic', 'underline', 'strike',
                                'h2', 'h3',
                                'bulletList', 'orderedList', 'blockquote',
                                'link', 'codeBlock',
                                'undo', 'redo',
                            ])
                            ->columnSpanFull(),
                    ])
                    ->columns(2),

                Section::make('SEO')
                    // Corregido: La propiedad 'label' no existe en Section, se debe usar 'heading'
                    ->heading('Configuración SEO')
                    ->schema([
                        TextInput::make('meta_title')
                            ->label('Meta Title')
                            ->helperText('Título que aparece en buscadores (máx 60 caracteres)')
                            ->maxLength(60),

                        Textarea::make('meta_description')
                            ->label('Meta Description')
                            ->helperText('Descripción que aparece en las listas de blog (máx 160 caracteres)')
                            ->maxLength(160)
                            ->rows(2),

                        TextInput::make('keyword')
                            ->label('Keyword Principal')
                            ->helperText('Palabra clave objetivo para este artículo'),

                        Toggle::make('index')
                            ->label('Indexar en buscadores')
                            ->helperText('Permitir que Google indexe este artículo')
                            ->default(true),
                    ])
                    ->columns(2),
            ]);
    }
}
