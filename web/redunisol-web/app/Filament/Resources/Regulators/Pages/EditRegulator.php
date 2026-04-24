<?php

namespace App\Filament\Resources\Regulators\Pages;

use App\Filament\Resources\Regulators\RegulatorResource;
use Filament\Actions\DeleteAction;
use Filament\Resources\Pages\EditRecord;

class EditRegulator extends EditRecord
{
    protected static string $resource = RegulatorResource::class;

    protected function getHeaderActions(): array
    {
        return [
            DeleteAction::make(),
        ];
    }
}
