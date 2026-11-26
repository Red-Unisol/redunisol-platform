<?php

namespace App\Console\Commands;

use App\Services\EdnaFreshIntake;
use App\Services\SalesChatRoutingPolicy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class EdnaIntakeCutover extends Command
{
    protected $signature = 'edna:intake-cutover {action=status : status or activate} {--fresh-declaration : Enable the new declaration contract after Kestra is deployed} {--ownership : Enable the commercial ownership contract for new requests} {--sales-chat-routing : Enable unified Benefits and reopening handoffs for new entries}';

    protected $description = 'Activate native V3 binding once for new incoming messages, without recovering old work';

    public function handle(): int
    {
        $action = $this->argument('action');
        if (! in_array($action, ['status', 'activate'], true)) {
            return self::INVALID;
        }
        $name = $this->option('fresh-declaration') ? EdnaFreshIntake::DECLARATION : 'native-v3-v1';
        if ($this->option('sales-chat-routing')) {
            if ($this->option('fresh-declaration') || $this->option('ownership')) {
                return self::INVALID;
            }
            $name = SalesChatRoutingPolicy::CUTOVER;
            if ($action === 'activate' && ! DB::table('edna_intake_cutovers')->where('name', $name)->exists()) {
                app(SalesChatRoutingPolicy::class)->assertTransferIsolation();
            }
        } elseif ($this->option('ownership')) {
            if ($this->option('fresh-declaration')) {
                return self::INVALID;
            }
            $name = EdnaFreshIntake::OWNERSHIP;
            if ($action === 'activate') {
                $line = app(\App\Services\EdnaBitrix::class)->call('imopenlines.config.get', ['CONFIG_ID' => 1]);
                if ((string) ($line['ID'] ?? '') !== '1' || ($line['CRM_TRANSFER_CHANGE'] ?? '') !== 'N'
                    || ! DB::table('edna_intake_cutovers')->where('name', EdnaFreshIntake::DECLARATION)->exists()) {
                    $this->error('Verificá la configuración de VENTAS y la activación del contrato de declaraciones.');

                    return self::FAILURE;
                }
            }
        }
        if ($action === 'activate') {
            DB::transaction(function () use ($name): void {
                // Future deploys cannot move the boundary or make old entries eligible.
                DB::table('edna_intake_cutovers')->insertOrIgnore([
                    'name' => $name, 'entry_id_after' => DB::table('edna_incoming_events')->max('id') ?? 0,
                    'starts_at' => now()->utc(),
                ]);
            });
        }
        $this->line(json_encode(['cutover' => DB::table('edna_intake_cutovers')->where('name', $name)->first()], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
