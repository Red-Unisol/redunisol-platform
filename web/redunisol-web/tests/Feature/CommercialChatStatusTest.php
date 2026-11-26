<?php

use App\Filament\Pages\BitrixRoutingSettingsPage;
use App\Models\User;
use App\Services\CommercialChatStatus;
use App\Services\EdnaBitrix;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Livewire\Livewire;

beforeEach(function () {
    $this->crm = new class extends EdnaBitrix
    {
        public array $calls = [];
        public int $count = 0;
        public array $transfers = [];
        public array $session = ['id' => 501, 'chatId' => 601, 'configId' => 1, 'operatorId' => 74827,
            'status' => 'new', 'dateOperatorAnswer' => null, 'dateFirstAnswer' => null];

        public function call(string $method, array $payload = []): mixed
        {
            $this->calls[] = $method;

            return match ($method) {
                'imopenlines.dialog.get' => ['id' => 601, 'owner' => 74827, 'entity_type' => 'LINES',
                    'entity_id' => 'whatsappbyedna|1|synthetic|999', 'entity_data_1' => 'Y|LEAD|700|N|N|501|1794333600',
                    'text_field_enabled' => true],
                'imopenlines.v2.Session.list' => ['sessions' => [$this->session], 'hasNextPage' => false],
                'imopenlines.v2.Session.Stat.get' => ['sessions' => [['sessionId' => 501, 'transfersCount' => $this->count]]],
                'imopenlines.v2.Session.Transfer.list' => ['transfers' => $this->transfers],
                default => throw new LogicException('Unexpected CRM call'),
            };
        }
    };
    $this->app->instance(EdnaBitrix::class, $this->crm);
    $this->event = ['id' => '78', 'sessionId' => 501, 'chatId' => 601, 'type' => 'USER', 'mode' => 'MANUAL',
        'initiatorId' => 74827, 'toOperatorId' => 29, 'date' => '2026-11-26T15:12:00Z'];
});

test('the lookup separates the selected seller, a queue assignment, and an actual human take', function () {
    $this->actingAs(User::factory()->create(['email' => 'admin@redunisol.local']));
    $this->crm->count = 1;
    $this->crm->transfers = [array_replace($this->event, ['type' => 'QUEUE', 'mode' => 'AUTO'])];
    $proof = ['source' => 'bitrix_openline_session', 'evidence' => 'external_message_id', 'verified' => true,
        'entry_event_id' => 32, 'entry_message_id' => '737', 'message_id' => '6012', 'activity_id' => '102',
        'chat_id' => '601', 'session_id' => '501'];
    DB::table('web_form_chat_routes')->insert(['entry_event_id' => 32, 'submission_id' => (string) Str::uuid(),
        'proof' => json_encode($proof), 'deal_id' => '901', 'seller_id' => '29', 'transfer_state' => 'observed']);
    DB::table('edna_intake_chat_routes')->insert(['request_id' => 72, 'state' => 'not_needed',
        'proof' => json_encode(array_replace($proof, ['session_id' => '490'])), 'assigned_case' => '{"seller_id":"98765"}']);
    $page = Livewire::test(BitrixRoutingSettingsPage::class)->assertSee('Consultar sesión');
    expect($this->crm->calls)->toBe([]);
    $page->set('chatLookup', '601')->call('lookupChat')->assertHasNoErrors()->assertSee('bandeja de distribución')
        ->assertSee('Negociación #901')->assertSee('(#29)')->assertDontSee('98765')
        ->assertSee('Sin transferencia a una persona registrada')->assertSee('Sin toma de operador registrada');
    $this->crm->transfers = [$this->event];
    $page->call('lookupChat')->assertSee('Manual · Nico')->assertSee('26/11/2026 12:12:00 ART')
        ->assertSee('Sin toma de operador registrada');
    $this->crm->session['dateOperatorAnswer'] = '2026-11-26T15:18:00Z';
    $page->call('lookupChat')->assertSee('Toma registrada por Bitrix el 26/11/2026 12:18:00 ART');
});

test('native transfer identity and completeness determine confirmed delivery independently of the CRM owner', function () {
    $this->crm->count = 1;
    $auto = array_replace($this->event, ['initiatorId' => 71283]);
    $this->crm->transfers = [$auto, $auto];
    $read = app(CommercialChatStatus::class);
    $result = $read->lookup(601);
    expect($result['transfers'])->toHaveCount(1)
        ->and($result['transfers'][0]['origin'])->toContain('Automática')
        ->and($result['selections'])->toBe([])->and($result['attention'])->toBe('Sin toma de operador registrada.');
    $this->crm->count = 2;
    expect($read->lookup(601)['transfers'])->toBeNull();
    $this->crm->count = 1;
    $this->crm->transfers = [array_replace($auto, ['sessionId' => 500])];
    expect($read->lookup(601)['transfers'])->toBeNull();
});

test('outbound activity and missing operator identity leave human attention unconfirmed', function () {
    $this->crm->session['dateFirstAnswer'] = '2026-11-26T15:18:00Z';
    $read = app(CommercialChatStatus::class);
    expect($read->lookup(601)['attention'])->toContain('Sin evidencia suficiente');
    $this->crm->session['dateOperatorAnswer'] = '2026-11-26T15:18:00Z';
    $this->crm->session['operatorId'] = 71283;
    expect($read->lookup(601)['attention'])->toContain('Sin evidencia suficiente');
});
