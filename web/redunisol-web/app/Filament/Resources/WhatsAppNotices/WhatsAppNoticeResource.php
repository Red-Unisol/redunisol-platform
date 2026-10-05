<?php

namespace App\Filament\Resources\WhatsAppNotices;

use App\Filament\Resources\WhatsAppNotices\Pages\ListWhatsAppNotices;
use App\Models\EdnaOutOfHoursSend;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Model;
use UnitEnum;

class WhatsAppNoticeResource extends Resource
{
    protected static ?string $model = EdnaOutOfHoursSend::class;

    protected static ?string $slug = 'whats-app-notices';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedChatBubbleLeft;

    protected static ?string $navigationLabel = 'Avisos de WhatsApp';

    protected static ?string $modelLabel = 'aviso de WhatsApp';

    protected static ?string $pluralModelLabel = 'Avisos de WhatsApp';

    protected static string|UnitEnum|null $navigationGroup = 'Informes';

    public static function table(Table $table): Table
    {
        return $table->columns([
            TextColumn::make('id')->label('ID')->sortable(),
            TextColumn::make('received_at')->label('Consulta recibida')->dateTime('d/m/Y H:i', 'America/Argentina/Cordoba')->sortable(),
            TextColumn::make('recipient')->label('Teléfono')->formatStateUsing(fn ($state) => $state ? str_repeat('*', max(0, strlen($state) - 4)).substr($state, -4) : 'Eliminado por retención'),
            TextColumn::make('notice_type')->label('Tipo')->formatStateUsing(fn ($state) => $state === 'managed' ? 'En gestión' : 'General'),
            TextColumn::make('advisor_id')->label('ID de asesor'),
            TextColumn::make('state')->label('Estado')->badge(),
            TextColumn::make('reason')->label('Motivo')->toggleable(),
            TextColumn::make('send_started_at')->label('Inicio de envío')->dateTime('d/m/Y H:i', 'America/Argentina/Cordoba')->sortable(),
            TextColumn::make('message_text')->label('Texto enviado')->wrap()->limit(160)->toggleable(isToggledHiddenByDefault: true),
        ])->filters([
            SelectFilter::make('notice_type')->label('Tipo')->options(['managed' => 'En gestión', 'general' => 'General']),
            SelectFilter::make('state')->label('Estado')->options(array_combine(
                ['pending', 'sending', 'accepted', 'confirmed', 'unknown', 'rejected', 'cancelled', 'expired'],
                ['Pendiente', 'Enviando', 'Aceptado', 'Confirmado', 'Incierto', 'Rechazado', 'Cancelado', 'Vencido'])),
        ])->defaultSort('id', 'desc');
    }

    public static function canCreate(): bool
    {
        return false;
    }

    public static function canEdit(Model $record): bool
    {
        return false;
    }

    public static function canDelete(Model $record): bool
    {
        return false;
    }

    public static function canDeleteAny(): bool
    {
        return false;
    }

    public static function getPages(): array
    {
        return ['index' => ListWhatsAppNotices::route('/')];
    }
}
