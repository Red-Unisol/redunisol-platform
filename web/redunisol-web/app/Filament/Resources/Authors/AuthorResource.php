<?php

namespace App\Filament\Resources\Authors;

use App\Filament\Resources\Authors\Pages\CreateAuthor;
use App\Filament\Resources\Authors\Pages\EditAuthor;
use App\Filament\Resources\Authors\Pages\ListAuthors;
use App\Models\Author;
use BackedEnum;
use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Forms\Components\FileUpload;
use Filament\Forms\Components\RichEditor;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\ImageColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Support\Str;
use UnitEnum;

class AuthorResource extends Resource
{
    protected static ?string $model = Author::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedUserCircle;

    protected static UnitEnum|string|null $navigationGroup = 'Blog';

    protected static ?string $navigationLabel = 'Autores';

    protected static ?string $recordTitleAttribute = 'name';

    protected static ?int $navigationSort = 5;

    public static function form(Schema $schema): Schema
    {
        return $schema->schema([
            TextInput::make('name')
                ->label('Nombre')
                ->required()
                ->live(onBlur: true)
                ->afterStateUpdated(fn ($state, $set) => $set('slug', Str::slug($state)))
                ->columnSpanFull(),

            TextInput::make('slug')
                ->label('Slug')
                ->required()
                ->unique(ignoreRecord: true)
                ->helperText('URL del perfil: /autores/{slug}')
                ->columnSpanFull(),

            TextInput::make('role')
                ->label('Cargo / Especialidad')
                ->placeholder('Especialista en finanzas personales'),

            Toggle::make('is_active')
                ->label('Activo')
                ->default(true)
                ->inline(false),

            FileUpload::make('photo')
                ->label('Foto')
                ->image()
                ->directory('authors')
                ->columnSpanFull(),

            RichEditor::make('bio')
                ->label('Biografía')
                ->toolbarButtons([
                    'bold', 'italic', 'underline',
                    'link',
                    'bulletList', 'orderedList',
                    'undo', 'redo',
                ])
                ->columnSpanFull(),
        ])->columns(2);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                ImageColumn::make('photo')
                    ->label('Foto')
                    ->circular()
                    ->width(40)
                    ->height(40),

                TextColumn::make('name')
                    ->label('Nombre')
                    ->searchable()
                    ->sortable(),

                TextColumn::make('role')
                    ->label('Cargo / Especialidad'),

                IconColumn::make('is_active')
                    ->label('Activo')
                    ->boolean(),

                TextColumn::make('posts_count')
                    ->label('Artículos')
                    ->counts('posts')
                    ->sortable(),
            ])
            ->actions([
                EditAction::make(),
            ])
            ->bulkActions([
                BulkActionGroup::make([
                    DeleteBulkAction::make(),
                ]),
            ]);
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index'  => ListAuthors::route('/'),
            'create' => CreateAuthor::route('/create'),
            'edit'   => EditAuthor::route('/{record}/edit'),
        ];
    }
}
