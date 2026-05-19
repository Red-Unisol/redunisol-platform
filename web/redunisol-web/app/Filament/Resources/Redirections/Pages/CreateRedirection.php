<?php

namespace App\Filament\Resources\Redirections\Pages;

use App\Filament\Resources\Redirections\RedirectionResource;
use App\Http\Middleware\HandleRedirections;
use Filament\Resources\Pages\CreateRecord;

class CreateRedirection extends CreateRecord
{
    protected static string $resource = RedirectionResource::class;

    protected function afterCreate(): void
    {
        HandleRedirections::clearCache();
    }
}
