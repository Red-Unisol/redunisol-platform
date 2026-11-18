<?php

declare(strict_types=1);

/** Local generation only: the canonical builder never calls Bitrix or sends messages. */
function buildRejectionNoticeCatalog(string $repository): array
{
    $relative = 'kestra/automations/marketing-crm/bitrix/rejection-notifications';
    $source = $repository.'/'.$relative;
    $builder = 'kestra/tools/build_bitrix_rejection_notifications.php';
    $manifest = json_decode(file_get_contents($source.'/manifest.json'), true, 32, JSON_THROW_ON_ERROR);
    $temporary = tempnam(sys_get_temp_dir(), 'ru-rej-');
    if ($temporary === false) {
        throw new RuntimeException('Cannot reserve a local rejection build artifact.');
    }
    try {
        $process = proc_open([PHP_BINARY, $repository.'/'.$builder, $source, $temporary, '1'],
            [['pipe', 'r'], ['pipe', 'w'], ['pipe', 'w']], $pipes);
        if (! is_resource($process)) {
            throw new RuntimeException('Cannot start the canonical rejection builder.');
        }
        fclose($pipes[0]);
        stream_get_contents($pipes[1]);
        stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        if (proc_close($process) !== 0) {
            throw new RuntimeException('Canonical rejection builder failed.');
        }
        $export = json_decode(file_get_contents($temporary.'.json'), true, 512, JSON_THROW_ON_ERROR);
        $branches = [];
        rejectionNoticeReasonBranches($export['TEMPLATE'][0], $branches);
        $notices = [];
        $withoutChat = [];
        $sources = [$builder, $relative.'/manifest.json', $relative.'/document-fields.json'];
        foreach ($manifest['sources'] as $item) {
            $sources[] = $relative.'/sources/'.$item['template_id'].'.json';
            $branch = $branches[$item['reason_xml_id']] ?? null;
            if (! is_array($branch) || ($branch['Properties']['Title'] ?? null) !== $item['reason_label']) {
                throw new RuntimeException('Canonical rejection reason branch is missing or inconsistent.');
            }
            $messages = rejectionNoticePublicChats($branch);
            if ($messages === []) {
                $withoutChat[] = $item['reason_label'];

                continue;
            }
            if (count($messages) !== 1) {
                throw new RuntimeException('A rejection reason must have one unambiguous public notice.');
            }
            $text = $messages[0];
            if (str_contains($text, '{=') || str_contains($text, '{{') || str_contains($text, '${')) {
                throw new RuntimeException('Variable rejection copy requires an explicit matching contract.');
            }
            $normalized = trim(str_replace(["\r\n", "\r"], "\n", $text), " \t\n");
            if ($normalized === '' || preg_match('//u', $normalized) !== 1) {
                throw new RuntimeException('Canonical rejection copy is empty or invalid.');
            }
            $notices[] = ['source_template_id' => $item['template_id'], 'reason_xml_id' => $item['reason_xml_id'],
                'reason_label' => $item['reason_label'], 'text' => $text,
                'template_sha256' => hash('sha256', $text), 'normalized_sha256' => hash('sha256', $normalized)];
        }
        sort($sources);
        $hashes = [];
        foreach (array_unique($sources) as $file) {
            $hashes[$file] = hash('sha256', str_replace("\r\n", "\n", file_get_contents($repository.'/'.$file)));
        }

        return ['schema_version' => 1, 'normalization' => 'crlf-to-lf-ascii-edge-space-v1',
            'generated_by' => 'web/redunisol-web/tools/build-rejection-notices.php',
            'canonical_builder' => $builder, 'source_sha256_lf' => $hashes,
            'without_public_chat' => $withoutChat, 'notices' => $notices];
    } finally {
        if (is_file($temporary.'.json')) {
            unlink($temporary.'.json');
        }
        if (is_file($temporary)) {
            unlink($temporary);
        }
    }
}

function rejectionNoticeReasonBranches(array $node, array &$branches): void
{
    if (($node['Activated'] ?? 'Y') !== 'Y') {
        return;
    }
    foreach ($node['Properties']['mixedcondition'] ?? [] as $condition) {
        if (($condition['field'] ?? '') === 'UF_CRM_REJECTION_REASON' && ($condition['operator'] ?? '') === '=') {
            $key = (string) $condition['value'];
            if (isset($branches[$key])) {
                throw new RuntimeException('Canonical rejection reason is duplicated.');
            }
            $branches[$key] = $node;
        }
    }
    foreach ($node['Children'] ?? [] as $child) {
        rejectionNoticeReasonBranches($child, $branches);
    }
}

function rejectionNoticePublicChats(array $node): array
{
    if (($node['Activated'] ?? 'Y') !== 'Y') {
        return [];
    }
    if (($node['Type'] ?? '') === 'IfElseActivity') {
        throw new RuntimeException('Conditional rejection copy requires explicit review.');
    }
    if (($node['Type'] ?? '') === 'ImOpenLinesMessageActivity') {
        $properties = $node['Properties'] ?? [];
        if (($properties['IsSystem'] ?? '') !== 'N' || ! is_string($properties['MessageText'] ?? null)
            || ! empty($properties['Attachment'])) {
            throw new RuntimeException('Only plain public rejection copy can be recognized.');
        }

        return [$properties['MessageText']];
    }
    $messages = [];
    foreach ($node['Children'] ?? [] as $child) {
        $messages = [...$messages, ...rejectionNoticePublicChats($child)];
    }

    return $messages;
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    $output = $argv[1] ?? dirname(__DIR__).'/resources/crm/rejection-notices.json';
    $catalog = buildRejectionNoticeCatalog(dirname(__DIR__, 3));
    if (! is_dir(dirname($output))) {
        mkdir(dirname($output), 0777, true);
    }
    if (file_put_contents($output, json_encode($catalog, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n") === false) {
        throw new RuntimeException('Cannot write the rejection notice catalog.');
    }
    echo count($catalog['notices'])." public rejection notices generated.\n";
}
