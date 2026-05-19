<?php

namespace App\Filament\Resources\Redirections\Pages;

use App\Filament\Resources\Redirections\RedirectionResource;
use App\Http\Middleware\HandleRedirections;
use Filament\Actions\DeleteAction;
use Filament\Resources\Pages\EditRecord;

class EditRedirection extends EditRecord
{
    protected static string $resource = RedirectionResource::class;

    protected function afterSave(): void
    {
        HandleRedirections::clearCache();
    }

    protected function getHeaderActions(): array
    {
        return [
            DeleteAction::make()
                ->after(fn () => HandleRedirections::clearCache()),
        ];
    }
}
