<x-filament-panels::page>
    <div class="mb-2 text-sm text-gray-500 dark:text-gray-400">
        El orden define el round-robin. Podés pausar un vendedor sin quitarlo del bucket.
    </div>

    <form wire:submit="save">
        {{ $this->form }}
    </form>
</x-filament-panels::page>
