<?php

use App\Filament\Pages\BitrixRoutingSettingsPage;
use App\Filament\Pages\BitrixSellersPage;
use App\Models\BitrixRoutingBucket;
use App\Models\BitrixRoutingSeller;
use App\Models\User;
use App\Services\BitrixUserDirectory;
use App\Support\BitrixRoutingConfig;
use App\Support\BitrixSellerRegistry;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;
use Symfony\Component\HttpKernel\Exception\HttpException;

function fakeSellerDirectory(mixed $response): void
{
    Http::swap(new Factory);
    Http::preventStrayRequests();
    Http::fake(['*/user.get.json' => $response]);
}

beforeEach(function () {
    config(['edna.bitrix_url' => 'https://redunisol.bitrix24.es/rest/1/testtoken/']);
    Cache::flush();
    Http::preventStrayRequests();
    $this->admin = User::factory()->create(['email' => 'admin@redunisol.local']);
    $this->registry = app(BitrixSellerRegistry::class);
    $this->initial = $this->registry->enabledIds();
    $this->directoryRows = BitrixRoutingSeller::all()->map(fn ($seller) => [
        'ID' => (string) $seller->bitrix_user_id, 'NAME' => $seller->name, 'LAST_NAME' => '',
        'EMAIL' => 'cuenta'.$seller->bitrix_user_id.'@example.test', 'ACTIVE' => true, 'USER_TYPE' => 'employee',
    ])->all();
    $this->directoryRows[] = ['ID' => '200001', 'NAME' => 'Patricia', 'LAST_NAME' => 'Prueba', 'EMAIL' => 'patricia@example.test', 'ACTIVE' => true, 'USER_TYPE' => 'employee'];
    $this->directoryRows[] = ['ID' => '8057', 'NAME' => 'Stefania', 'LAST_NAME' => 'Histórica', 'EMAIL' => 'anterior@example.test', 'ACTIVE' => false, 'USER_TYPE' => 'employee'];
    fakeSellerDirectory(Http::response(['result' => $this->directoryRows]));
});

test('the directory paginates and caches names emails and activity without enabling users', function () {
    $rows = array_map(fn ($id) => ['ID' => $id, 'NAME' => 'Usuario '.$id, 'EMAIL' => $id.'@example.test', 'ACTIVE' => true, 'USER_TYPE' => 'employee'], range(3000, 3049));
    fakeSellerDirectory(fn ($request) => Http::response(['result' => $request['start'] === 0 ? $rows : [$this->directoryRows[array_key_last($this->directoryRows)]]]));
    $directory = app(BitrixUserDirectory::class);
    $users = $directory->users();
    expect($users)->toHaveCount(51)
        ->and($users[3000]['email'])->toBe('3000@example.test')
        ->and($users[8057]['active'])->toBeFalse()
        ->and($directory->users())->toBe($users)
        ->and($this->registry->enabledIds())->toBe($this->initial);
    Http::assertSentCount(2);
    Http::assertSent(fn ($request) => $request['FILTER']['USER_TYPE'] === 'employee' && $request['SELECT'] === ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'ACTIVE', 'USER_TYPE']);
});

test('new selected employees become available by name and email without automatic line assignments', function () {
    $before = app(BitrixRoutingConfig::class)->activePools();
    $this->registry->save([...$this->initial, 200001], 0, $this->admin);
    expect(BitrixRoutingConfig::sellerOptions()[200001])->toBe('Patricia Prueba — patricia@example.test')
        ->and(app(BitrixRoutingConfig::class)->activePools())->toBe($before);
    $audit = DB::table('bitrix_routing_seller_changes')->sole();
    expect((int) $audit->actor_id)->toBe($this->admin->id)
        ->and(json_decode($audit->after_ids, true))->toContain(200001)
        ->and(json_decode($audit->paused_buckets, true))->toBe([]);
});

test('disabling pauses stored inherited and default lines and re-enabling never resumes them', function () {
    $stored = [['user_id' => 10451, 'paused' => false], ['user_id' => 29, 'paused' => true], ['user_id' => 128399, 'paused' => false]];
    BitrixRoutingBucket::create(['key' => 'catamarca_general', 'sellers' => $stored]);
    BitrixRoutingBucket::create(['key' => 'santa_fe_anses', 'sellers' => $stored]);
    $selected = array_values(array_diff($this->initial, [10451]));
    $impact = $this->registry->disablingImpact($selected);
    expect($impact[0]['lines'])->toContain('Catamarca — General', 'Santa Fe', 'Mutual PAII', 'Córdoba — General');

    $this->registry->save($selected, 0, $this->admin);
    foreach (app(BitrixRoutingConfig::class)->activePools() as $pool) {
        expect($pool)->not->toContain(10451);
    }
    expect(BitrixRoutingBucket::find('catamarca_general')->sellers)->toBe([
        ['user_id' => 10451, 'paused' => true], ['user_id' => 29, 'paused' => true], ['user_id' => 128399, 'paused' => false],
    ]);
    $this->registry->save($this->initial, $this->registry->revision(), $this->admin);
    foreach (app(BitrixRoutingConfig::class)->activePools() as $pool) {
        expect($pool)->not->toContain(10451);
    }
    expect(BitrixRoutingConfig::sellerOptions())->toHaveKey(10451);
});

test('an empty enabled list also disables all defaults and the legacy endpoint pool', function () {
    $this->registry->save([], 0, $this->admin);
    $response = $this->getJson('/api/internal/bitrix-routing')->assertOk();
    foreach ($response->json() as $pool) {
        expect($pool)->toBe([]);
    }
});

test('an inactive or missing account cannot be enabled by a forged selection', function ($id) {
    expect(fn () => $this->registry->save([...$this->initial, $id], 0, $this->admin))->toThrow(ValidationException::class);
    expect($this->registry->enabledIds())->toBe($this->initial);
    $this->assertDatabaseCount('bitrix_routing_seller_changes', 0);
})->with([8057, 999999]);

test('a fresh Bitrix failure cannot save stale cached activity or change the catalog', function () {
    app(BitrixUserDirectory::class)->users();
    fakeSellerDirectory(Http::response(['error' => 'ACCESS_DENIED'], 403));
    expect(fn () => $this->registry->save([...$this->initial, 200001], 0, $this->admin))->toThrow(RuntimeException::class);
    expect($this->registry->enabledIds())->toBe($this->initial);
    $this->assertDatabaseCount('bitrix_routing_seller_changes', 0);
});

test('catalog and line forms cannot overwrite a newer administrator change', function () {
    $config = app(BitrixRoutingConfig::class);
    $oldLines = $config->forForm();
    $this->registry->save([], 0, $this->admin);
    expect(fn () => $this->registry->save($this->initial, 0, $this->admin))->toThrow(ValidationException::class)
        ->and(fn () => $config->save($oldLines, 0))->toThrow(ValidationException::class)
        ->and($this->registry->enabledIds())->toBe([]);
});

test('public routing reads remain independent of Bitrix availability', function () {
    fakeSellerDirectory(Http::response([], 503));
    $this->getJson('/api/internal/bitrix-routing')->assertOk()->assertJsonPath('cordoba_unc', [53121]);
    Http::assertNothingSent();
});

test('the admin selector shows names emails inactive accounts and confirms affected lines before saving', function () {
    $this->actingAs($this->admin);
    $component = Livewire::test(BitrixSellersPage::class)
        ->assertSee('patricia@example.test')
        ->assertSee('anterior@example.test')
        ->assertSee('inactiva')
        ->fillForm(['seller_ids' => array_values(array_diff($this->initial, [10451]))])
        ->mountAction('save')
        ->assertActionMounted('save');
    expect($component->instance()->getMountedAction()->getModalContent()->render())
        ->toContain('Líneas que quedarán pausadas:', 'Santa Fe');
    expect($this->registry->enabledIds())->toBe($this->initial);

    Livewire::test(BitrixSellersPage::class)->fillForm(['seller_ids' => [...$this->initial, 200001]])
        ->callAction('save')->assertHasNoFormErrors();
    expect($this->registry->enabledIds())->toContain(200001);
    Livewire::test(BitrixRoutingSettingsPage::class)->assertSee('patricia@example.test');
});

test('the directory outage preserves selection and disables the save action', function () {
    fakeSellerDirectory(Http::response([], 503));
    $this->actingAs($this->admin);
    Livewire::test(BitrixSellersPage::class)->assertSee('No se pudo consultar Bitrix')
        ->assertFormSet(['seller_ids' => $this->initial])->assertActionDisabled('save');
    expect($this->registry->enabledIds())->toBe($this->initial);
});

test('non-admin users cannot view or change the enabled seller catalog', function () {
    $user = User::factory()->create(['email' => 'empleado@example.test']);
    $this->actingAs($user)->get('/admin/vendedores-bitrix')->assertForbidden();
    try {
        $this->registry->save([], 0, $user);
        $this->fail('Unauthorized changes must be rejected.');
    } catch (HttpException $exception) {
        expect($exception->getStatusCode())->toBe(403);
    }
    Http::assertNothingSent();
    expect($this->registry->enabledIds())->toBe($this->initial);
});
