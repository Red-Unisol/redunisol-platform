<?php

namespace App\Filament\Resources\Categories;

use App\Models\Category;
use BackedEnum;
use UnitEnum; // Asegúrate de incluir esto
use Filament\Forms\Components\TextInput;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class CategoryResource extends Resource
{
    protected static ?string $model = Category::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedTag;

    // Ajustado exactamente a la firma que exige el error: UnitEnum|string|null
    protected static UnitEnum|string|null $navigationGroup = 'Blog';

    // Ajustado a ?string como pedía el error anterior
    protected static ?string $navigationLabel = 'Categorías';

    protected static ?string $recordTitleAttribute = 'name';

    public static function form(Schema $schema): Schema
    {
        return $schema->components([
            TextInput::make('name')
                ->label('Nombre')
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
                ->helperText('Ej: jubilados-cordoba'),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('name')
                    ->label('Nombre')
                    ->searchable()
                    ->sortable(),

                TextColumn::make('slug')
                    ->label('Slug')
                    ->searchable()
                    ->fontFamily('mono')
                    ->color('gray'),

                TextColumn::make('blogs_count')
                    ->label('Posts')
                    ->counts('blogs')
                    ->sortable(),
            ])
            ->defaultSort('name');
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index'  => \App\Filament\Resources\Categories\Pages\ListCategories::route('/'),
            'create' => \App\Filament\Resources\Categories\Pages\CreateCategory::route('/create'),
            'edit'   => \App\Filament\Resources\Categories\Pages\EditCategory::route('/{record}/edit'),
        ];
    }
}
