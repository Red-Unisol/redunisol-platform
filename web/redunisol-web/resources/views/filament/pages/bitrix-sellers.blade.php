<x-filament-panels::page>
    @unless ($this->directoryAvailable)
        <div role="alert" class="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            No se pudo consultar Bitrix. La lista guardada se conserva y no se pueden guardar cambios hasta actualizar los usuarios.
        </div>
    @endunless

    <form wire:submit.prevent="mountAction('save')">
        {{ $this->form }}
    </form>

    <p class="text-sm text-gray-500 dark:text-gray-400">
        Al retirar una cuenta se pausarán sus líneas. Si volvés a habilitarla, esas líneas seguirán pausadas hasta que las revises en Distribución Bitrix.
    </p>
</x-filament-panels::page>
