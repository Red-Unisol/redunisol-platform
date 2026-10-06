<?php

namespace App\Console\Commands;

use App\Services\EdnaBitrix;
use Illuminate\Console\Command;
use Throwable;

class EdnaCrmFields extends Command
{
    protected $signature = 'edna:crm-fields {--apply : Create missing WA fields on contacts and leads}';

    protected $description = 'Check router CRM fields; never changes existing field definitions or records';

    public function handle(): int
    {
        try {
            $api = new EdnaBitrix;
            $missing = false;
            foreach (['contact', 'lead'] as $entity) {
                $fields = $api->schema($entity, (bool) $this->option('apply'));
                if ($this->option('apply')) {
                    $fields = $api->schema($entity);
                }
                $missing = $missing || count($fields) > 0;
                $this->line(json_encode(['entity' => $entity, 'missing' => $fields]));
            }

            return $missing ? self::FAILURE : self::SUCCESS;
        } catch (Throwable) {
            $this->error('CRM schema could not be verified. Check permissions and field types; secrets suppressed.');

            return self::FAILURE;
        }
    }
}
