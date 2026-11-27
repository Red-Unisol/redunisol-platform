<?php

namespace App\Console\Commands;

use App\Services\EdnaFreshIntake;
use App\Services\SalesChatRoutingPolicy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class EdnaIntakeCutover extends Command
{
    protected $signature = 'edna:intake-cutover {action=status : status or activate} {--fresh-declaration : Enable the new declaration contract after Kestra is deployed} {--ownership : Enable the commercial ownership contract for new requests} {--sales-chat-routing : Enable unified Benefits and reopening handoffs for new entries} {--v3-validity : Use shared v3 validity and profile reuse for new organic and paid entries} {--review-seller : Honor a verified Kestra seller for a new v3 in credit review}';

    protected $description = 'Activate native V3 binding once for new incoming messages, without recovering old work';

    public function handle(): int
    {
        $action = $this->argument('action');
        $options = ['fresh-declaration', 'ownership', 'sales-chat-routing', 'v3-validity', 'review-seller'];
        if (! in_array($action, ['status', 'activate'], true) || count(array_filter($options, fn ($option) => $this->option($option))) > 1) {
            return self::INVALID;
        }
        $name = $this->option('fresh-declaration') ? EdnaFreshIntake::DECLARATION : 'native-v3-v1';
        if ($this->option('review-seller')) {
            $name = EdnaFreshIntake::REVIEW_SELLER;
        } elseif ($this->option('v3-validity')) {
            $name = EdnaFreshIntake::V3_VALIDITY;
        } elseif ($this->option('sales-chat-routing')) {
            $name = SalesChatRoutingPolicy::CUTOVER;
            if ($action === 'activate' && ! DB::table('edna_intake_cutovers')->where('name', $name)->exists()) {
                app(SalesChatRoutingPolicy::class)->assertTransferIsolation();
            }
        } elseif ($this->option('ownership')) {
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
                $startsAt = now()->utc();
                DB::table('edna_intake_cutovers')->insertOrIgnore([
                    'name' => $name, 'entry_id_after' => DB::table('edna_incoming_events')->max('id') ?? 0,
                    // Provider callbacks can have only second precision. Exclude the partial activation second.
                    'starts_at' => in_array($name, [EdnaFreshIntake::V3_VALIDITY, EdnaFreshIntake::REVIEW_SELLER], true)
                        ? $startsAt->ceilSecond() : $startsAt,
                ]);
            });
        }
        $this->line(json_encode(['cutover' => DB::table('edna_intake_cutovers')->where('name', $name)->first()], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
