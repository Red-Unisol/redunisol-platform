<div class="space-y-4 text-sm">
    @if ($impact)
        <p>Se deshabilitarán estas cuentas para nuevas asignaciones:</p>
        <ul class="space-y-3">
            @foreach ($impact as $seller)
                <li>
                    <p class="font-medium">{{ $seller['name'] }}</p>
                    <p class="text-gray-500 dark:text-gray-400">
                        {{ $seller['lines'] ? 'Líneas que quedarán pausadas: '.implode(', ', $seller['lines']).'.' : 'Sin líneas configuradas.' }}
                    </p>
                </li>
            @endforeach
        </ul>
        <p>Las negociaciones ya asignadas conservarán su responsable.</p>
    @else
        <p>Se actualizará la lista de vendedores habilitados. Después podés asignarles líneas en Distribución Bitrix.</p>
    @endif
</div>
