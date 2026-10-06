<x-filament-panels::page>
    @php($groups = $this->getReportGroups())

    @if ($groups->isEmpty())
        <x-filament::section>
            <div class="text-sm text-gray-500 dark:text-gray-400">
                Todavía no hay reportes disponibles.
            </div>
        </x-filament::section>
    @else
        <div class="grid gap-4 xl:grid-cols-2">
            @foreach ($groups as $group)
                <x-filament::section>
                    <x-slot name="heading">{{ $group['title'] }}</x-slot>
                    <x-slot name="description">{{ $group['description'] }}</x-slot>

                    <div class="space-y-5">
                        <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                            <div class="space-y-2">
                                <x-filament::badge color="gray">
                                    {{ $group['area'] }}
                                </x-filament::badge>

                                <div class="text-sm text-gray-500 dark:text-gray-400">
                                    <div class="font-medium text-gray-950 dark:text-white">
                                        Actualizado {{ date('d/m/Y \a \l\a\s H:i', $group['latest']['modified_at']) }}
                                    </div>
                                    <div>{{ Number::fileSize($group['latest']['size']) }}</div>
                                </div>
                            </div>

                            <x-filament::button
                                tag="a"
                                icon="heroicon-o-arrow-down-tray"
                                href="{{ route('admin.reports.download', ['path' => $group['latest']['path']]) }}"
                            >
                                Descargar último
                            </x-filament::button>
                        </div>

                        @if ($group['history']->isNotEmpty())
                            <details class="border-t border-gray-200 pt-4 dark:border-white/10">
                                <summary class="cursor-pointer text-sm font-medium text-gray-700 marker:text-gray-400 hover:text-gray-950 dark:text-gray-300 dark:hover:text-white">
                                    Ver historial ({{ $group['history']->count() }})
                                </summary>

                                <div class="mt-3 divide-y divide-gray-100 dark:divide-white/5">
                                    @foreach ($group['history'] as $report)
                                        <div class="flex items-center justify-between gap-4 py-3 first:pt-1">
                                            <div class="min-w-0">
                                                <div class="truncate text-sm font-medium text-gray-950 dark:text-white">
                                                    {{ pathinfo($report['name'], PATHINFO_FILENAME) }}
                                                </div>
                                                <div class="text-xs text-gray-500 dark:text-gray-400">
                                                    {{ date('d/m/Y H:i', $report['modified_at']) }}
                                                    <span aria-hidden="true">·</span>
                                                    {{ Number::fileSize($report['size']) }}
                                                </div>
                                            </div>

                                            <x-filament::icon-button
                                                tag="a"
                                                color="gray"
                                                icon="heroicon-o-arrow-down-tray"
                                                label="Descargar {{ $report['name'] }}"
                                                href="{{ route('admin.reports.download', ['path' => $report['path']]) }}"
                                            />
                                        </div>
                                    @endforeach
                                </div>
                            </details>
                        @endif
                    </div>
                </x-filament::section>
            @endforeach
        </div>
    @endif
</x-filament-panels::page>
