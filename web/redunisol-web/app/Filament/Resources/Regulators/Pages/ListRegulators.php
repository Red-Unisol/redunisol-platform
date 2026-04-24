<?php

namespace App\Filament\Resources\Regulators\Pages;

use App\Filament\Resources\Regulators\RegulatorResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListRegulators extends ListRecords
{
    protected static string $resource = RegulatorResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make(),
        ];
    }
}
