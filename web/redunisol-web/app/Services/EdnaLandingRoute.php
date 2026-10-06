<?php

namespace App\Services;

use InvalidArgumentException;

class EdnaLandingRoute
{
    // Task 23055: Catamarca intentionally shares one landing across four situations.
    public const ROUTES = [
        'cordoba' => [
            'jubilado_pensionado' => ['cordoba_jubilado', '/prestamos-para-jubilados/jubilados-cordoba'],
            'empleado_publico' => ['cordoba_empleado_publico', '/prestamos-para-empleados-publicos/empleados-publicos-cordoba'],
            'policia_cordoba' => ['cordoba_policia', '/prestamos-para-policias/policias-cordoba'],
            'docente' => ['cordoba_docente', '/prestamos-para-docentes/docentes-cordoba'],
            'salud' => ['cordoba_salud', '/prestamos-para-personal-de-salud/salud-cordoba'],
            'unc' => ['cordoba_unc', '/prestamos-para-empleados-universidad-nacional-de-cordoba'],
            'otra' => ['cordoba_otra', '/'],
        ],
        'catamarca' => [
            'empleado_publico' => ['catamarca_empleado_publico', '/prestamos-para-empleados-publicos/empleados-publicos-catamarca'],
            'policia' => ['catamarca_policia', '/prestamos-para-empleados-publicos/empleados-publicos-catamarca'],
            'docente' => ['catamarca_docente', '/prestamos-para-empleados-publicos/empleados-publicos-catamarca'],
            'salud' => ['catamarca_salud', '/prestamos-para-empleados-publicos/empleados-publicos-catamarca'],
            'otra' => ['catamarca_otra', '/'],
        ],
        'caba' => ['pfa' => ['caba_pfa', '/prestamos-para-policias/policia-federal'], 'otra' => ['caba_otra', '/']],
        'otra' => ['otra' => ['otra_provincia', '/']],
    ];

    public function resolve(array $payload): array
    {
        $data = json_decode($payload['messageContent']['text'] ?? '', true, 32, JSON_THROW_ON_ERROR);
        $province = $data['provincia'] ?? null;
        $situation = $province === 'otra' ? 'otra' : ($data['situacion_'.(is_string($province) ? $province : '')] ?? null);
        if (! is_string($province) || ! is_string($situation) || ! isset(self::ROUTES[$province][$situation])) {
            throw new InvalidArgumentException('Invalid router answer.');
        }
        [$segment, $path] = self::ROUTES[$province][$situation];
        $url = 'https://redunisol.com.ar'.$path.'?'.http_build_query([
            'utm_source' => 'whatsapp', 'utm_medium' => 'messaging',
            'utm_campaign' => 'web_whatsapp_router', 'utm_content' => $segment,
        ], '', '&', PHP_QUERY_RFC3986);

        return ['province' => $province, 'situation' => $situation, 'segment' => $segment,
            'landing_url' => $url, 'message_text' => "Gracias por completar tus datos. Podés continuar tu consulta acá:\n".$url];
    }
}
