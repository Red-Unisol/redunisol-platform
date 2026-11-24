<?php

use App\Services\FinalizarIvaService;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    $this->withoutVite();
    Http::preventStrayRequests();
    config()->set('finalizar.legacy_clients.caja.base_url', 'https://loans.test');
    config()->set('finalizar.legacy_clients.solicitudes.base_url', 'https://loans.test');
    config()->set('finalizar.legacy_clients.caja.evaluate_base_url', 'https://evaluate.test');
    config()->set('finalizar.legacy_clients.solicitudes.evaluate_base_url', 'https://evaluate.test');
    config()->set('finalizar.metamap.client_id', 'test-client');
});

function ivaPlan(): array
{
    $rows = [[0, '1017049/0', 150000], [0, 'PG 999 20/11/2026', -150000], [1, 'PG 1000', -100]];
    foreach (range(12, 1) as $i) {
        $rows[] = [$i, "1017049/{$i}", $i === 12 ? 186513.48 : 186513.37];
    }

    return $rows;
}

function ivaLoan(): array
{
    return ['numero_prestamo' => '1017049', 'prestamo_tem' => '12.10', 'prestamo_tna' => '147.22', 'prestamo_tea' => '293.79', 'prestamo_cft' => '323.26'];
}

function fakeIva(array $loanRow = [1017049, true, 0.121, 1000000, 12], ?array $plan = null, int $status = 200): void
{
    Http::fake(function (Request $request) use ($loanRow, $plan, $status) {
        if (str_contains($request->url(), '/finSolicitud/')) {
            return Http::response([
                'NumeroPrestamo' => 1017049, 'cuotas' => 12, 'cuotaResultante' => '186513,37',
                'montoAfinanciar' => '$ 1.000.000,00', 'prestamoTEM' => '0,1210', 'prestamoTNA' => '1,4722',
                'prestamoTEA' => '2,9379', 'prestamoCFT' => '3,2326', 'linea' => 'amejuca',
            ]);
        }

        return Http::response($request['tipo'] === 'F.Module.Cuentas.Prestamos.Prestamo' ? [$loanRow] : ($plan ?? ivaPlan()), $status);
    });
}

it('uses the same adjusted rates in all Finalizar routes and MetaMap variables', function ($route) {
    fakeIva();
    $this->get($route.'?sol=255118&ntrans=0&linea=amejuca')
        ->assertOk()->assertInertia(fn (Assert $page) => $page->component('finalizar')
        ->where('finalizar.loan.lleva_iva', true)
        ->where('finalizar.loan.tasas_estado', 'complete')
        ->where('finalizar.loan.prestamo_tem', '10.00')
        ->where('finalizar.loan.prestamo_tna', '120.00')
        ->where('finalizar.loan.prestamo_tea', '213.84')
        ->where('finalizar.loan.prestamo_cft', '449.59')
        ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey5.value', '120.00%')
        ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey6.value', '213.84%')
        ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey7.value', '449.59%')
        ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey8.value', '10.00%')
        ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey7.title', 'CFT con IVA')
        );
    Http::assertSentCount(3);
    Http::assertSent(fn (Request $request) => ($request['cmd'] ?? '') === '[NroCuenta] = 1017049');
})->with(['/finalizar', '/finalizar.php', '/finalizar-nvo']);

it('leaves rates unchanged and does not query installments for loans without IVA', function () {
    fakeIva([1017049, false, 0.121, 1000000, 12]);
    $loan = app(FinalizarIvaService::class)->apply(ivaLoan(), 'caja');
    expect($loan['prestamo_tem'])->toBe('12.10')->and($loan['prestamo_cft'])->toBe('323.26')
        ->and($loan['lleva_iva'])->toBeFalse()->and($loan['tasas_estado'])->toBe('original');
    Http::assertSentCount(1);
});

it('accepts the JSON encoded string returned by Vimarx with Accept application/json', function () {
    Http::fake(function (Request $request) {
        $rows = $request['tipo'] === 'F.Module.Cuentas.Prestamos.Prestamo'
            ? [[1017049, true, 0.121, 1000000, 12]] : ivaPlan();

        return Http::response(json_encode(json_encode($rows)), 200, ['Content-Type' => 'application/json']);
    });
    $loan = app(FinalizarIvaService::class)->apply(ivaLoan(), 'caja');
    expect($loan['tasas_estado'])->toBe('complete')->and($loan['prestamo_cft'])->toBe('449.59');
});

it('retains corrected interest rates if the cost cannot be obtained', function ($plan) {
    fakeIva(plan: $plan);
    $loan = app(FinalizarIvaService::class)->apply(ivaLoan(), 'caja');
    expect($loan['prestamo_tem'])->toBe('10.00')->and($loan['prestamo_cft'])->toBe('')
        ->and($loan['tasas_estado'])->toBe('partial');
})->with([
    'missing installment' => fn () => array_slice(ivaPlan(), 0, -1),
    'duplicate installment' => fn () => [...ivaPlan(), [1, '1017049/1', 186513.37]],
    'negative amount' => fn () => [[1, '1017049/1', -1]],
    'empty plan' => fn () => [],
]);

it('does not treat an unavailable flag as false or retain inflated rates', function ($row, $status) {
    fakeIva($row, status: $status);
    $loan = app(FinalizarIvaService::class)->apply(ivaLoan(), 'caja');
    expect($loan['lleva_iva'])->toBeNull()->and($loan['prestamo_tem'])->toBe('')
        ->and($loan['prestamo_cft'])->toBe('')->and($loan['tasas_estado'])->toBe('unavailable');
})->with([
    [[1017049, null, 0.121, 1000000, 12], 200],
    [[1017049, 'false', 0.121, 1000000, 12], 200],
    [[9000, true, 0.121, 1000000, 12], 200],
    [[1017049, true, 0.121, 1000000, 12], 503],
]);

it('keeps signing metadata available when enrichment fails', function () {
    fakeIva(status: 503);
    $this->get('/finalizar?sol=255118&linea=amejuca')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('finalizar.error', null)
            ->where('finalizar.loan.tasas_estado', 'unavailable')
            ->where('finalizar.metamap.client_id', 'test-client')
            ->where('finalizar.metamap.metadata.eSignature.customVariables.variableKey8.value', '')
            ->has('finalizar.metamap.metadata.eSignature.customVariables.variableKey'));
});

it('handles connection failures without classifying the loan as exempt', function () {
    Http::fake(['*' => Http::failedConnection()]);
    $loan = app(FinalizarIvaService::class)->apply(ivaLoan(), 'caja');
    expect($loan['lleva_iva'])->toBeNull()->and($loan['prestamo_cft'])->toBe('');
});

it('retains corrected interest when the installment query times out', function () {
    Http::fake(function (Request $request) {
        return $request['tipo'] === 'F.Module.Cuentas.Prestamos.Prestamo'
            ? Http::response([[1017049, true, 0.121, 1000000, 12]])
            : Http::failedConnection();
    });
    $loan = app(FinalizarIvaService::class)->apply(ivaLoan(), 'caja');
    expect($loan['tasas_estado'])->toBe('partial')->and($loan['prestamo_tem'])->toBe('10.00')
        ->and($loan['prestamo_cft'])->toBe('');
});

it('does not query unsupported circuits or allow query injection through a loan number', function () {
    Http::fake();
    $loan = ivaLoan();
    expect(app(FinalizarIvaService::class)->apply($loan, 'fiat'))->toBe($loan);
    $loan['numero_prestamo'] = '1 Or 1=1';
    expect(app(FinalizarIvaService::class)->apply($loan, 'caja')['tasas_estado'])->toBe('unavailable');
    Http::assertNothingSent();
});
