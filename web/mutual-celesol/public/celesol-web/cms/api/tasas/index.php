<?php
// Permitir solicitudes desde cualquier origen (o reemplazá "*" por tu dominio)
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");

// Manejar solicitudes OPTIONS (preflight)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$url = 'https://us-central1-mutual-celesol.cloudfunctions.net/obtenerTasas';

try {
    $response = @file_get_contents($url);

    if ($response === false) {
        http_response_code(500);
        echo json_encode([
            'error' => 'No se pudo obtener respuesta del servidor de tasas.'
        ]);
        exit;
    }

    echo $response;

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Excepción al hacer la solicitud.',
        'detalle' => $e->getMessage()
    ]);
}