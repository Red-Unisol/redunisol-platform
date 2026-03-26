<?php

namespace App\Filament\Resources\Blogs\Schemas;

use Filament\Infolists\Components\ImageEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Schema;
use Filament\Schemas\Components\Section;

class BlogInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Información del Blog')
                    ->schema([
                        ImageEntry::make('image')
                            ->label('Imagen')
                            ->height(200),

                        TextEntry::make('title')
                            ->label('Título'),

                        TextEntry::make('author.name')
                            ->label('Autor'),

                        TextEntry::make('categories.name')
                            ->label('Categorías')
                            ->badge(),

                        TextEntry::make('created_at')
                            ->label('Fecha de creación')
                            ->dateTime('d/m/Y H:i'),

                        TextEntry::make('updated_at')
                            ->label('Última actualización')
                            ->dateTime('d/m/Y H:i'),
                    ])
                    ->columns(2),

                Section::make('Contenido')
                    ->schema([
                        TextEntry::make('content')
                            ->label('')
                            ->html()
                            ->columnSpanFull(),
                    ]),
            ]);
    }
}
