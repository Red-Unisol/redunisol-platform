<x-filament-panels::page>
    @php($groups = $this->getReportGroups())

    @if ($groups->isEmpty())
        <x-filament::section>
            <div class="text-sm text-gray-500 dark:text-gray-400">
                Todavía no hay reportes disponibles.
            </div>
        </x-filament::section>
    @else
        <div class="grid gap-4 xl:grid-cols-2" wire:poll.15s>
            @foreach ($groups as $group)
                <x-filament::section wire:key="report-{{ $group['key'] }}">
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
                                        Actualizado {{ \Illuminate\Support\Carbon::createFromTimestamp($group['latest']['modified_at'], 'America/Argentina/Buenos_Aires')->format('d/m/Y \a \l\a\s H:i') }}
                                    </div>
                                    <div class="break-all">{{ $group['latest']['download_name'] }}</div>
                                    <div>{{ Number::fileSize($group['latest']['size']) }}</div>
                                </div>
                            </div>

                            <div class="flex flex-wrap gap-2">
                                @if ($group['regenerable'])
                                    <x-filament::button
                                        color="gray"
                                        icon="heroicon-o-arrow-path"
                                        wire:click="regenerate('{{ $group['key'] }}')"
                                        wire:loading.attr="disabled"
                                        wire:target="regenerate"
                                        :disabled="! $group['regeneration_available'] || $group['regeneration']['busy']"
                                    >
                                        {{ $group['regeneration']['busy'] ? 'Regenerando…' : 'Regenerar' }}
                                    </x-filament::button>
                                @endif

                                <x-filament::button
                                    tag="a"
                                    icon="heroicon-o-arrow-down-tray"
                                    href="{{ route('admin.reports.download', ['path' => $group['latest']['path']]) }}"
                                >
                                    Descargar
                                </x-filament::button>
                            </div>
                        </div>

                        @if ($group['regenerable'] && ! $group['regeneration_available'])
                            <p class="text-sm text-gray-500">La regeneración todavía no está configurada.</p>
                        @elseif ($group['regeneration']['state'])
                            <p class="text-sm text-gray-500" role="status">
                                @if ($group['regeneration']['state'] === 'UNKNOWN')
                                    No se pudo confirmar el inicio. Esperá dos minutos antes de volver a intentar.
                                @elseif ($group['regeneration']['busy'])
                                    Regeneración en curso. La descarga se actualiza cuando se publica el informe; puede demorar varias horas.
                                @elseif (in_array($group['regeneration']['state'], ['FAILED', 'KILLED', 'CANCELLED'], true))
                                    La regeneración no se completó. Podés volver a intentarlo; la descarga anterior sigue disponible.
                                @else
                                    El proceso finalizó. Consultá la fecha de actualización del archivo; los informes por lotes se publican al completar todos los lotes.
                                @endif
                            </p>
                        @endif

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
                                                    {{ $report['download_name'] }}
                                                </div>
                                                <div class="text-xs text-gray-500 dark:text-gray-400">
                                                    {{ \Illuminate\Support\Carbon::createFromTimestamp($report['modified_at'], 'America/Argentina/Buenos_Aires')->format('d/m/Y H:i') }}
                                                    <span aria-hidden="true">·</span>
                                                    {{ Number::fileSize($report['size']) }}
                                                </div>
                                            </div>

                                            <x-filament::icon-button
                                                tag="a"
                                                color="gray"
                                                icon="heroicon-o-arrow-down-tray"
                                                label="Descargar {{ $report['download_name'] }}"
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
