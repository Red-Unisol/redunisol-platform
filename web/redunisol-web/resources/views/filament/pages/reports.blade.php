<x-filament-panels::page>
    <x-filament::section>
        <x-slot name="heading">Archivos disponibles</x-slot>
        <x-slot name="description">Los reportes se ordenan del más reciente al más antiguo.</x-slot>

        @php($reports = $this->getReports())

        @if ($reports->isEmpty())
            <div class="text-sm text-gray-500 dark:text-gray-400">
                Todavía no hay reportes disponibles.
            </div>
        @else
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="border-b border-gray-200 text-left dark:border-white/10">
                            <th class="px-3 py-3 font-semibold">Reporte</th>
                            <th class="px-3 py-3 font-semibold">Carpeta</th>
                            <th class="px-3 py-3 font-semibold">Actualizado</th>
                            <th class="px-3 py-3 font-semibold">Tamaño</th>
                            <th class="px-3 py-3 text-right font-semibold">Acción</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($reports as $report)
                            <tr class="border-b border-gray-100 dark:border-white/5">
                                <td class="px-3 py-3 font-medium">{{ $report['name'] }}</td>
                                <td class="px-3 py-3 text-gray-500">{{ $report['group'] }}</td>
                                <td class="px-3 py-3">{{ date('d/m/Y H:i', $report['modified_at']) }}</td>
                                <td class="px-3 py-3">{{ Number::fileSize($report['size']) }}</td>
                                <td class="px-3 py-3 text-right">
                                    <x-filament::button
                                        tag="a"
                                        size="sm"
                                        icon="heroicon-o-arrow-down-tray"
                                        href="{{ route('admin.reports.download', ['path' => $report['path']]) }}"
                                    >
                                        Descargar
                                    </x-filament::button>
                                </td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            </div>
        @endif
    </x-filament::section>
</x-filament-panels::page>
