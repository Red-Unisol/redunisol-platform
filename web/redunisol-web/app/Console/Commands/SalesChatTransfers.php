<?php

namespace App\Console\Commands;

use App\Services\SalesChatTransfer;
use Illuminate\Console\Command;

class SalesChatTransfers extends Command
{
    protected $signature = 'sales:chat-transfers {action=poll : poll or status}';

    protected $description = 'Deliver or inspect the durable sales-chat requests received from Kestra';

    public function handle(SalesChatTransfer $delivery): int
    {
        if ($this->argument('action') === 'status') {
            $this->line(json_encode(['enabled' => (bool) config('edna.kestra_chat_transfer_delivery_enabled'),
                'requests_by_state_and_reason' => SalesChatTransfer::counts()], JSON_THROW_ON_ERROR));
        } elseif ($this->argument('action') === 'poll') {
            $delivery->poll();
        } else {
            return self::INVALID;
        }

        return self::SUCCESS;
    }
}
