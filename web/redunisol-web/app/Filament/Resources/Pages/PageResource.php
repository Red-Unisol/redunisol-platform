<?php

namespace App\Filament\Resources\Pages;

use Filament\Forms\Form;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\Builder;
use Filament\Forms\Components\Repeater;

use App\Filament\Resources\Pages\Pages\CreatePage;
use App\Filament\Resources\Pages\Pages\EditPage;
use App\Filament\Resources\Pages\Pages\ListPages;
use App\Filament\Resources\Pages\Schemas\PageForm;
use App\Filament\Resources\Pages\Tables\PagesTable;
use App\Models\Page;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;

class PageResource extends Resource
{
    protected static ?string $model = Page::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedRectangleStack;

    public static function form(Schema $schema): Schema
    {
        return $schema->schema([
            TextInput::make('title')
                ->required(),

            TextInput::make('slug')
                ->required()
                ->unique(ignoreRecord: true),

            Builder::make('sections')
                ->blocks([

                    // HERO
                    Builder\Block::make('hero')
                        ->schema([
                            TextInput::make('title')->required(),
                            TextInput::make('highlight')->required(),
                            Textarea::make('description'),
                            TextInput::make('cta'),
                        ]),

                    // SERVICES
                    Builder\Block::make('services')
                        ->schema([
                            Repeater::make('items')
                                ->schema([
                                    TextInput::make('title')->required(),
                                ])
                        ]),

                    // FAQS
                    Builder\Block::make('faqs')
                        ->schema([
                            Repeater::make('items')
                                ->schema([
                                    TextInput::make('question')->required(),
                                    Textarea::make('answer')->required(),
                                ])
                        ]),
                ])
                ->columnSpanFull(),
        ]);
    }

    public static function table(Table $table): Table
    {
        return PagesTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [
            //
        ];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListPages::route('/'),
            'create' => CreatePage::route('/create'),
            'edit' => EditPage::route('/{record}/edit'),
        ];
    }
}
