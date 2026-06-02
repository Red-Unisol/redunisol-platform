<?php

namespace App\Filament\Resources\Redirections;

use App\Filament\Resources\Redirections\Pages\CreateRedirection;
use App\Filament\Resources\Redirections\Pages\EditRedirection;
use App\Filament\Resources\Redirections\Pages\ListRedirections;
use App\Http\Middleware\HandleRedirections;
use App\Models\Redirection;
use BackedEnum;
use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use UnitEnum;

class RedirectionResource extends Resource
{
    protected static ?string $model = Redirection::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedArrowTopRightOnSquare;

    protected static UnitEnum|string|null $navigationGroup = 'Configuración';

    protected static ?string $navigationLabel = 'Redirecciones';

    protected static ?string $recordTitleAttribute = 'from';

    protected static ?int $navigationSort = 20;

    public static function form(Schema $schema): Schema
    {
        return $schema->schema([
            TextInput::make('from')
                ->label('Ruta de origen')
                ->helperText('Ruta interna del sitio. Ej: /pagina-vieja, /prestamos-personal')
                ->prefix('/')
                ->placeholder('pagina-vieja')
                ->required()
                ->unique(ignoreRecord: true)
                ->dehydrateStateUsing(fn (string $state): string => '/' . ltrim($state, '/'))
                ->formatStateUsing(fn (?string $state): string => ltrim((string) $state, '/'))
                ->columnSpanFull(),

            TextInput::make('to')
                ->label('Destino')
                ->helperText('Ruta interna (ej: /nueva-pagina) o URL externa (ej: https://otro-sitio.com).')
                ->placeholder('/nueva-pagina')
                ->required()
                ->columnSpanFull(),

            Toggle::make('is_external')
                ->label('Enlace externo')
                ->helperText('Activá si el destino es una URL de otro dominio.')
                ->default(false)
                ->inline(false),

            Toggle::make('is_active')
                ->label('Activa')
                ->helperText('Desactivá para suspenderla sin borrarla.')
                ->default(true)
                ->inline(false),
        ])->columns(2);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('from')
                    ->label('Desde')
                    ->searchable()
                    ->sortable()
                    ->fontFamily('mono')
                    ->copyable()
                    ->copyMessage('Copiado'),

                TextColumn::make('to')
                    ->label('Hacia')
                    ->searchable()
                    ->fontFamily('mono')
                    ->limit(50)
                    ->tooltip(fn (Redirection $record): string => $record->to),

                IconColumn::make('is_external')
                    ->label('Externo')
                    ->boolean()
                    ->trueIcon(Heroicon::OutlinedArrowTopRightOnSquare)
                    ->falseIcon(Heroicon::OutlinedArrowRight)
                    ->trueColor('warning')
                    ->falseColor('gray'),

                IconColumn::make('is_active')
                    ->label('Activa')
                    ->boolean(),

                TextColumn::make('updated_at')
                    ->label('Modificada')
                    ->dateTime('d/m/Y H:i')
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->defaultSort('from')
            ->filters([
                TernaryFilter::make('is_active')
                    ->label('Estado')
                    ->trueLabel('Solo activas')
                    ->falseLabel('Solo inactivas'),

                TernaryFilter::make('is_external')
                    ->label('Tipo')
                    ->trueLabel('Solo externas')
                    ->falseLabel('Solo internas'),
            ])
            ->actions([
                EditAction::make(),
            ])
            ->bulkActions([
                BulkActionGroup::make([
                    DeleteBulkAction::make()
                        ->after(fn () => HandleRedirections::clearCache()),
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
            'index'  => ListRedirections::route('/'),
            'create' => CreateRedirection::route('/create'),
            'edit'   => EditRedirection::route('/{record}/edit'),
        ];
    }
}
