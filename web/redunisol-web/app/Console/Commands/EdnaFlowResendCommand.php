<?php

namespace App\Console\Commands;

use App\Services\EdnaFlowResend;
use Illuminate\Console\Command;
use Throwable;

class EdnaFlowResendCommand extends Command
{
    protected $signature = 'edna:flow-resend {send_id : Original canonical Flow send ID}
        {--expected-case= : Original canonical case UUID}
        {--expected-lead= : Verified original Bitrix lead ID}
        {--expected-old-mid= : Exact terminal FAILED provider message ID}
        {--operation= : Unique operator operation UUID; repeat to inspect the same operation}
        {--confirmed-no-attention : Operator confirmed a fresh CRM and response preflight}
        {--apply : Archive the failed attempt and enqueue its one controlled resend}';

    protected $description = 'Preview or explicitly queue one audited resend without changing its intake case';

    public function handle(EdnaFlowResend $service): int
    {
        $id = (string) $this->argument('send_id');
        if (! ctype_digit($id) || (int) $id < 1) {
            $this->line(json_encode(['applied' => false, 'reason' => 'invalid_send_id']));

            return self::FAILURE;
        }
        try {
            $result = $this->option('apply')
                ? $service->apply((int) $id, (string) $this->option('expected-case'), (string) $this->option('expected-lead'),
                    (string) $this->option('expected-old-mid'), (string) $this->option('operation'), (bool) $this->option('confirmed-no-attention'))
                : $service->preview((int) $id);
            $this->line(json_encode($result, JSON_THROW_ON_ERROR));

            return self::SUCCESS;
        } catch (Throwable) {
            // Provider exceptions can contain a credential or customer identity.
            $this->line(json_encode(['send_id' => (int) $id, 'applied' => false, 'reason' => 'controlled_resend_refused']));

            return self::FAILURE;
        }
    }
}
