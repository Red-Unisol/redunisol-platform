<?php

declare(strict_types=1);

if ($argc !== 3) {
    fwrite(STDERR, "Uso: php build_bitrix_finguru_email_bp.php <origen.bpt> <salida.bpt>\n");
    exit(2);
}

$inputPath = $argv[1];
$outputPath = $argv[2];
$compressed = file_get_contents($inputPath);
if ($compressed === false) {
    throw new RuntimeException("No se pudo leer el BPT de origen.");
}

$serialized = gzuncompress($compressed);
if ($serialized === false) {
    throw new RuntimeException("El BPT de origen no contiene un stream zlib valido.");
}

$export = unserialize($serialized, ['allowed_classes' => false]);
if (!is_array($export) || !isset($export['TEMPLATE'][0])) {
    throw new RuntimeException("El BPT de origen no contiene un template Bitrix valido.");
}

$originalRoot = $export['TEMPLATE'][0];
$finguruBranch = findActivity(
    $originalRoot,
    'IfElseBranchActivity',
    'Finguru',
);
$emailActivity = findActivity(
    $originalRoot,
    'CrmSendEmailActivity',
    'Send email to customer',
);

$emailActivity['Children'] = [];
$finguruBranch['Children'] = [$emailActivity];

$sourceCondition = activity(
    'IfElseActivity',
    'A90000_00000_00000_00001',
    ['Title' => 'Enviar correo Finguru', 'EditorComment' => 'Unica accion operativa conservada en Bitrix.'],
    [
        $finguruBranch,
        activity(
            'IfElseBranchActivity',
            'A90001_00000_00000_00001',
            ['Title' => 'No Finguru'],
        ),
    ],
);

$newRoot = $originalRoot;
$newRoot['Properties']['Title'] = 'Finguru email only';
$newRoot['Children'] = [$sourceCondition];
$export['TEMPLATE'] = [$newRoot];

$result = gzcompress(serialize($export), 9);
if ($result === false || file_put_contents($outputPath, $result) === false) {
    throw new RuntimeException("No se pudo escribir el BPT reducido.");
}

$roundTrip = unserialize(gzuncompress(file_get_contents($outputPath)), ['allowed_classes' => false]);
if (!is_array($roundTrip) || !isset($roundTrip['TEMPLATE'][0])) {
    throw new RuntimeException("El BPT generado no supera la verificacion de lectura.");
}

$generatedRoot = $roundTrip['TEMPLATE'][0];
$activityCounts = countActivityTypes($generatedRoot);
$generatedFinguruBranch = findActivity($generatedRoot, 'IfElseBranchActivity', 'Finguru');
$generatedEmail = findActivity($generatedRoot, 'CrmSendEmailActivity', 'Send email to customer');

$expectedCounts = [
    'SequentialWorkflowActivity' => 1,
    'IfElseActivity' => 1,
    'IfElseBranchActivity' => 2,
    'CrmSendEmailActivity' => 1,
];
foreach ($expectedCounts as $type => $count) {
    if (($activityCounts[$type] ?? 0) !== $count) {
        throw new RuntimeException("Conteo inesperado para {$type}.");
    }
}
foreach (['SetFieldActivity', 'CrmChangeStatusActivity', 'TerminateActivity'] as $forbiddenType) {
    if (($activityCounts[$forbiddenType] ?? 0) !== 0) {
        throw new RuntimeException("El BPT generado contiene la actividad prohibida {$forbiddenType}.");
    }
}
if ($generatedFinguruBranch['Properties'] !== $finguruBranch['Properties']) {
    throw new RuntimeException("La condicion Finguru no coincide con el BPT original.");
}
if ($generatedEmail['Properties'] !== $emailActivity['Properties']) {
    throw new RuntimeException("La configuracion del correo no coincide con el BPT original.");
}

$summary = [
    'output' => $outputPath,
    'sha256' => hash_file('sha256', $outputPath),
    'activities' => $activityCounts,
    'email_properties_sha256' => hash('sha256', serialize($generatedEmail['Properties'])),
];
fwrite(STDOUT, json_encode($summary, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");

function activity(
    string $type,
    string $name,
    array $properties,
    array $children = [],
): array {
    return [
        'Type' => $type,
        'Name' => $name,
        'Activated' => 'Y',
        'Node' => null,
        'Properties' => $properties,
        'Children' => $children,
    ];
}

function findActivity(array $node, string $type, string $title): array
{
    if (
        ($node['Type'] ?? null) === $type
        && ($node['Properties']['Title'] ?? null) === $title
    ) {
        return $node;
    }

    foreach (($node['Children'] ?? []) as $child) {
        if (!is_array($child)) {
            continue;
        }
        try {
            return findActivity($child, $type, $title);
        } catch (RuntimeException) {
            // Continue searching sibling branches.
        }
    }

    throw new RuntimeException("No se encontro {$type} con titulo {$title}.");
}

function countActivityTypes(array $node): array
{
    $counts = [];
    $type = $node['Type'] ?? null;
    if (is_string($type)) {
        $counts[$type] = 1;
    }

    foreach (($node['Children'] ?? []) as $child) {
        if (!is_array($child)) {
            continue;
        }
        foreach (countActivityTypes($child) as $childType => $count) {
            $counts[$childType] = ($counts[$childType] ?? 0) + $count;
        }
    }

    ksort($counts);
    return $counts;
}
