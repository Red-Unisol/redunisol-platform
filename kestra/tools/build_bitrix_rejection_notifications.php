<?php

declare(strict_types=1);

// Builds an importable, local artifact. Never calls Bitrix or sends messages.
if ($argc !== 4 || !ctype_digit($argv[3]) || (int)$argv[3] < 1) {
    fwrite(STDERR, "Usage: php build_bitrix_rejection_notifications.php <source-dir> <output.bpt> <last-existing-lead-id>\n");
    exit(2);
}

function readJson(string $path): array {
    return json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
}

function activity(string $type, string $key, array $properties, array $children = []): array {
    return ['Type' => $type, 'Name' => 'R'.substr(hash('sha256', $key), 0, 30),
        'Activated' => 'Y', 'Properties' => $properties, 'Children' => $children];
}

function condition(string $field, string $operator, string $value): array {
    return ['object' => 'Document', 'field' => $field, 'operator' => $operator,
        'value' => $value, 'joiner' => 0];
}

function setState(string $key, string $field, string $value): array {
    return activity('SetFieldActivity', $key, ['Title' => 'Aviso rechazo: '.$value,
        'FieldValue' => [$field => $value], 'ModifiedBy' => [], 'MergeMultipleFields' => 'N']);
}

function copySource(array $node, string $prefix, array &$counts): array {
    $allowed = ['SequentialWorkflowActivity', 'ParallelActivity', 'SequenceActivity',
        'IfElseActivity', 'IfElseBranchActivity', 'CrmSendEmailActivity',
        'ImOpenLinesMessageActivity', 'CrmSendWhatsAppMessageActivity'];
    $type = $node['Type'];
    if (!in_array($type, $allowed, true)) {
        throw new RuntimeException('Unexpected source activity: '.$type);
    }
    preg_match_all('/\{=[^}:]+:/', json_encode($node['Properties'] ?? []), $matches);
    foreach ($matches[0] as $reference) if ($reference !== '{=Document:') {
        throw new RuntimeException('Source requires unsupported activity/variable references');
    }
    $node['Name'] = 'S'.substr(hash('sha256', $prefix.':'.$node['Name']), 0, 30);
    $counts[$type] = ($counts[$type] ?? 0) + 1;
    $children = [];
    foreach ($node['Children'] ?? [] as $child) $children[] = copySource($child, $prefix, $counts);
    $node['Children'] = $children;
    return $node;
}

$sourceDir = rtrim($argv[1], '/\\');
$output = $argv[2];
$cutoff = $argv[3];
$manifest = readJson($sourceDir.'/manifest.json');
$fields = readJson($sourceDir.'/document-fields.json');
$stateField = $manifest['notice_state_field'];
$fields[$stateField] = ['Name' => 'Aviso rechazo: estado', 'Type' => 'string',
    'BaseType' => 'string', 'Editable' => true, 'Filterable' => true, 'Multiple' => false, 'Required' => false];
$branches = [];
$counts = [];
$reasons = [];
foreach ($manifest['sources'] as $item) {
    $id = $item['template_id'];
    $source = readJson($sourceDir.'/sources/'.$id.'.json');
    if ($source['parameters'] || $source['variables'] || $source['constants']) {
        throw new RuntimeException('Source uses nonempty parameters, variables or constants: '.$id);
    }
    if (($fields['UF_CRM_REJECTION_REASON']['Options'][$item['reason_xml_id']] ?? null) !== $item['reason_label']) {
        throw new RuntimeException('Reason label / XML ID mismatch: '.$id);
    }
    if (isset($reasons[$item['reason_xml_id']])) throw new RuntimeException('Duplicate reason');
    $reasons[$item['reason_xml_id']] = true;
    $children = $source['template']['Children'];
    // The old Autonomo chat checks an employment enum deleted from Bitrix.
    // Route by the authoritative rejection reason instead of that stale value.
    if ($id === 387) {
        $oldCondition = $children[0]['Children'][0]['Children'][0];
        $oldBranch = $oldCondition['Children'][0];
        $oldValue = $oldBranch['Properties']['mixedcondition'][0]['value'] ?? null;
        $chat = $oldBranch['Children'][0];
        if ($oldCondition['Type'] !== 'IfElseActivity'
            || $oldValue !== '0b8c70305bf0f7b2a0823319ad31a3ea'
            || isset($fields['UF_CRM_1714071903']['Options'][$oldValue])
            || $chat['Type'] !== 'ImOpenLinesMessageActivity') {
            throw new RuntimeException('Autonomo source changed; re-audit obsolete condition');
        }
        $children[0]['Children'][0]['Children'] = [$chat];
    }
    // Template 407 accidentally has two emails. The requested behavior is
    // one open-channel message and the newer email, with matching wording.
    if ($id === 407) {
        $children[0]['Children'] = array_values(array_filter($children[0]['Children'],
            fn($sequence) => ($sequence['Children'][0]['Name'] ?? '') !== 'A51141_68911_32034_46491'));
        if (count($children[0]['Children']) !== 1) throw new RuntimeException('Unexpected convenio structure');
        $email = $children[0]['Children'][0]['Children'][0]['Properties'];
        if (!str_starts_with($email['MessageText'], 'base64,')) throw new RuntimeException('Expected encoded convenio email');
        $html = base64_decode(substr($email['MessageText'], 7), true);
        if ($html === false) throw new RuntimeException('Invalid convenio email encoding');
        $text = preg_replace('~<br\s*/?>|</p>~i', "\n", $html);
        $text = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/[\t ]+/', ' ', $text);
        $text = preg_replace('/\n[ \r]*\n(?:[ \r]*\n)*/', "\n\n", $text);
        $chatSource = readJson($sourceDir.'/sources/383.json');
        $chat = $chatSource['template']['Children'][0]['Children'][0]['Children'][0];
        if ($chat['Type'] !== 'ImOpenLinesMessageActivity') throw new RuntimeException('Unexpected reference chat');
        $chat['Name'] = 'ConvenioChat';
        $chat['Properties']['MessageText'] = trim($text);
        $chat['Properties']['Title'] = 'Enviar chat - no cumple requisitos para convenio';
        $children[0]['Children'][] = activity('SequenceActivity', 'convenio-chat-sequence', ['Title' => 'Chat convenio'], [$chat]);
    }
    $copied = [];
    foreach ($children as $child) $copied[] = copySource($child, (string)$id, $counts);
    $branches[] = activity('IfElseBranchActivity', 'reason-'.$id,
        ['Title' => $item['reason_label'], 'mixedcondition' => [condition('UF_CRM_REJECTION_REASON', '=', $item['reason_xml_id'])]],
        [setState('reserve-'.$id, $stateField, 'IN_PROGRESS'), ...$copied,
            setState('processed-'.$id, $stateField, 'PROCESSED')]);
}
$branches[] = activity('IfElseBranchActivity', 'unknown-reason',
    ['Title' => 'Sin plantilla: no enviar', 'truecondition' => '1']);
$routing = activity('IfElseActivity', 'route-by-reason', ['Title' => 'Aviso segun Motivo Rechazo'], $branches);
$eligible = activity('IfElseBranchActivity', 'eligible', ['Title' => 'Nuevo rechazo sin aviso previo',
    'mixedcondition' => [condition('STATUS_ID', '=', $manifest['target_stage']),
        condition('ID', '>', $cutoff), condition($stateField, '=', '')]], [$routing]);
$skip = activity('IfElseBranchActivity', 'skip', ['Title' => 'Historico o aviso ya procesado: omitir', 'truecondition' => '1']);
$guard = activity('IfElseActivity', 'eligibility', ['Title' => 'Proteccion de historicos y reingresos'], [$eligible, $skip]);
$root = activity('SequentialWorkflowActivity', 'root', ['Title' => 'Avisos de rechazo por motivo'], [$guard]);
$root['Name'] = 'Template';
$export = ['VERSION' => 2, 'TEMPLATE' => [$root], 'PARAMETERS' => [], 'VARIABLES' => [], 'CONSTANTS' => [], 'DOCUMENT_FIELDS' => $fields];
$compressed = gzcompress(serialize($export), 9);
if ($compressed === false || file_put_contents($output, $compressed) === false) throw new RuntimeException('Cannot write output');
if (unserialize(gzuncompress(file_get_contents($output)), ['allowed_classes' => false]) !== $export) {
    throw new RuntimeException('BPT round-trip verification failed');
}
file_put_contents($output.'.json', json_encode($export, JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)."\n");
echo json_encode(['output' => $output, 'sha256' => hash_file('sha256', $output),
    'last_existing_lead_id' => $cutoff, 'reason_count' => count($reasons), 'source_activities' => $counts], JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)."\n";
