<?php

namespace App\Filament\Resources\Redirections\Pages;

use App\Filament\Resources\Redirections\RedirectionResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListRedirections extends ListRecords
{
    protected static string $resource = RedirectionResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make(),
        ];
    }
}
