<x-filament-panels::page>
    <style>
        .ru-chat-lookup, .ru-chat-result dl { display: grid; gap: .75rem; }
        .ru-chat-lookup { max-width: 24rem; }
        .ru-chat-lookup button { justify-self: start; }
        .ru-chat-result { margin-top: 1rem; overflow-wrap: anywhere; }
        .ru-chat-result dl { margin-top: .75rem; }
        .ru-chat-result dt, .ru-chat-lookup label { font-weight: 600; }
        .ru-chat-result a { text-decoration: underline; }
    </style>
    <x-filament::section heading="Seguimiento de un chat de VENTAS">
        <form wire:submit="lookupChat" class="ru-chat-lookup">
            <label for="routing-chat-id" class="text-sm font-medium">ID del chat en Bitrix</label>
            <x-filament::input.wrapper>
                <x-filament::input id="routing-chat-id" wire:model="chatLookup" inputmode="numeric" autocomplete="off" />
            </x-filament::input.wrapper>
            @error('chatLookup') <p role="alert">{{ $message }}</p> @enderror
            <x-filament::button type="submit">Consultar sesión</x-filament::button>
        </form>
        @if ($chatStatus)
            <div aria-live="polite" class="ru-chat-result">
                <p><strong>Chat #{{ $chatStatus['chat'] }}</strong>
                    @if ($chatStatus['session'])
                        · Sesión #{{ $chatStatus['session'] }} · {{ $chatStatus['open'] ? 'Abierta' : 'Cerrada' }}<br>
                        Bandeja al consultar · {{ $chatStatus['inbox'] }}
                    @else
                        · Sin sesión actual identificada.
                    @endif
                </p>
                @if ($chatStatus['session'])
                    <dl>
                        <div>
                            <dt class="font-semibold">Vendedor elegido</dt>
                            <dd>
                                @if ($chatStatus['selections'] === null)
                                    No se pudo verificar la selección.
                                @else
                                    @forelse ($chatStatus['selections'] as $selection)
                                        <p>{{ $selection['source'] }} · {{ $selection['seller'] ?? 'Sin vendedor confirmado' }}
                                            @if ($selection['deal'])
                                                · <a class="underline" href="https://redunisol.bitrix24.es/crm/deal/details/{{ $selection['deal'] }}/" target="_blank" rel="noopener">Negociación #{{ $selection['deal'] }}</a>
                                            @endif
                                        </p>
                                    @empty
                                        Sin selección documentada para esta sesión.
                                    @endforelse
                                @endif
                            </dd>
                        </div>
                        <div>
                            <dt class="font-semibold">Transferencias confirmadas por Bitrix</dt>
                            <dd>
                                @if ($chatStatus['transfers'] === null)
                                    Historial de transferencias incompleto.
                                @else
                                    @forelse ($chatStatus['transfers'] as $transfer)
                                        <p>{{ $transfer['date'] }} · {{ $transfer['origin'] }} → {{ $transfer['target'] }}</p>
                                    @empty
                                        Sin transferencia a una persona registrada.
                                    @endforelse
                                @endif
                            </dd>
                        </div>
                        <div>
                            <dt class="font-semibold">Atención humana</dt>
                            <dd>{{ $chatStatus['attention'] }}</dd>
                        </div>
                    </dl>
                @endif
            </div>
        @endif
    </x-filament::section>

    <div class="mb-2 text-sm text-gray-500 dark:text-gray-400">
        El orden define el round-robin. Podés pausar un vendedor sin quitarlo del bucket.
    </div>

    <form wire:submit="save">
        {{ $this->form }}
    </form>
</x-filament-panels::page>
