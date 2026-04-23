<?php

namespace App\Filament\Resources\Blogs\Schemas;

use App\Models\Category;
use App\Models\User;
use Filament\Forms\Components\FileUpload;
use Filament\Forms\Components\RichEditor;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\Toggle;
use Filament\Schemas\Schema;
use Filament\Schemas\Components\Section;

class BlogForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Información del Blog')
                    ->schema([
                        TextInput::make('title')
                            ->label('Título')
                            ->required()
                            ->maxLength(255),

                        TextInput::make('slug')
                            ->label('Slug (URL)')
                            ->helperText('Identificador único en URL. Ej: mi-articulo-seo')
                            ->unique(ignoreRecord: true)
                            ->nullable(),

                        Select::make('author_id')
                            ->label('Autor')
                            ->relationship('author', 'name')
                            ->searchable()
                            ->preload()
                            ->required(),

                        Select::make('categories')
                            ->label('Categorías')
                            ->relationship('categories', 'name')
                            ->multiple()
                            ->searchable()
                            ->preload()
                            ->createOptionForm([
                                TextInput::make('name')
                                    ->label('Nombre de la categoría')
                                    ->required()
                                    ->maxLength(255),
                            ]),

                        FileUpload::make('image')
                            ->label('Imagen')
                            ->image()
                            ->directory('blogs')
                            ->imageEditor()
                            ->nullable(),

                        RichEditor::make('content')
                            ->label('Contenido')
                            ->required()
                            ->columnSpanFull(),
                    ])
                    ->columns(2),

                Section::make('SEO')
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
