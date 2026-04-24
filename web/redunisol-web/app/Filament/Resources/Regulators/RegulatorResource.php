<?php

namespace App\Filament\Resources\Regulators;

use App\Filament\Resources\Regulators\Pages\CreateRegulator;
use App\Filament\Resources\Regulators\Pages\EditRegulator;
use App\Filament\Resources\Regulators\Pages\ListRegulators;
use App\Models\Regulator;
use BackedEnum;
use Filament\Forms\Components\FileUpload;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Actions\BulkActionGroup;
use Filament\Tables\Actions\DeleteBulkAction;
use Filament\Tables\Actions\EditAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\ImageColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use UnitEnum;

class RegulatorResource extends Resource
{
    protected static ?string $model = Regulator::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedBuildingOffice;

    protected static UnitEnum|string|null $navigationGroup = 'Configuración';

    protected static ?string $navigationLabel = 'Entes Reguladores';

    protected static ?string $recordTitleAttribute = 'name';

    protected static ?int $navigationSort = 5;

    public static function form(Schema $schema): Schema
    {
        return $schema->schema([
            TextInput::make('name')
                ->label('Nombre completo')
                ->required()
                ->columnSpanFull(),

            TextInput::make('short_name')
                ->label('Nombre corto')
                ->helperText('Ej: Celesol, Fiat Concord'),

            TextInput::make('cuit')
                ->label('CUIT')
                ->helperText('Ej: 33-70870702-9'),

            TextInput::make('inaes_mat')
                ->label('Matrícula INAES')
                ->helperText('Ej: 768'),

            TextInput::make('bcra_code')
                ->label('Código BCRA')
                ->helperText('Ej: 55281'),

            TextInput::make('url')
                ->label('URL (sitio web o Data Fiscal)')
                ->url()
                ->columnSpanFull(),

            FileUpload::make('logo_path')
                ->label('Logo')
                ->image()
                ->directory('regulators')
                ->helperText('Imagen del logo del ente regulador.')
                ->columnSpanFull(),

            TextInput::make('sort_order')
                ->label('Orden de visualización')
                ->numeric()
                ->default(0),

            Toggle::make('is_active')
                ->label('Activo')
                ->default(true)
                ->inline(false),
        ])->columns(2);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                ImageColumn::make('logo_path')
                    ->label('Logo')
                    ->width(60)
                    ->height(30)
                    ->defaultImageUrl(fn () => null),

                TextColumn::make('name')
                    ->label('Nombre')
                    ->searchable()
                    ->sortable(),

                TextColumn::make('short_name')
                    ->label('Nombre Corto')
                    ->searchable(),

                TextColumn::make('cuit')
                    ->label('CUIT'),

                TextColumn::make('inaes_mat')
                    ->label('INAES Mat.'),

                TextColumn::make('bcra_code')
                    ->label('Cód. BCRA'),

                IconColumn::make('is_active')
                    ->label('Activo')
                    ->boolean(),

                TextColumn::make('sort_order')
                    ->label('Orden')
                    ->sortable(),
            ])
            ->defaultSort('sort_order')
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
            'index'  => ListRegulators::route('/'),
            'create' => CreateRegulator::route('/create'),
            'edit'   => EditRegulator::route('/{record}/edit'),
        ];
    }
}
