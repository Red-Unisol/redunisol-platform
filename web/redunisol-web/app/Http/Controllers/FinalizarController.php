<?php

namespace App\Http\Controllers;

use App\Models\Regulator;
use App\Models\SiteSetting;
use App\Services\FinalizarSolicitudService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

class FinalizarController extends Controller
{
    public function show(Request $request, FinalizarSolicitudService $finalizarSolicitud): Response
    {
        $normalizeTermsUrl = static function (string $url): string {
            return $url === '/terminos-y-condiciones'
                ? '/terminos-y-condiciones.pdf'
                : $url;
        };

        $getSettingOrEnv = function (string $settingKey, string $envKey, $default = '') {
            $setting = SiteSetting::get($settingKey, null);

            if (!is_null($setting) && $setting !== '') {
                return (string) $setting;
            }

            $env = env($envKey, null);

            if (!is_null($env) && $env !== '') {
                return (string) $env;
            }

            return (string) $default;
        };

        $settings = [
            'heading'          => $getSettingOrEnv('finalizar_heading', 'FINALIZAR_HEADING', 'Termina tu Solicitud'),
            'subheading'       => $getSettingOrEnv('finalizar_subheading', 'FINALIZAR_SUBHEADING', 'Su préstamo será descontado de la siguiente forma:'),
            'contact_question' => $getSettingOrEnv('finalizar_contact_question', 'FINALIZAR_CONTACT_QUESTION', '¿Tiene otra consulta para hacernos?'),
            'tna'              => $getSettingOrEnv('finalizar_tna', 'FINALIZAR_TNA', ''),
            'tea'              => $getSettingOrEnv('finalizar_tea', 'FINALIZAR_TEA', ''),
            'tnm'              => $getSettingOrEnv('finalizar_tnm', 'FINALIZAR_TNM', ''),
            'cft'              => $getSettingOrEnv('finalizar_cft', 'FINALIZAR_CFT', ''),
            'terms_url'        => $normalizeTermsUrl($getSettingOrEnv('finalizar_terms_url', 'FINALIZAR_TERMS_URL', '/terminos-y-condiciones.pdf')),
            'contact_email'    => $getSettingOrEnv('finalizar_contact_email', 'FINALIZAR_CONTACT_EMAIL', SiteSetting::get('contact_email', 'contacto@redunisol.com.ar')),
            'whatsapp_url'     => $getSettingOrEnv('finalizar_whatsapp_url', 'FINALIZAR_WHATSAPP_URL', ''),
            'facebook_url'     => $getSettingOrEnv('finalizar_facebook_url', 'FINALIZAR_FACEBOOK_URL', ''),
        ];

        $finalizar = $finalizarSolicitud->resolve(
            $request->query('sol'),
            $request->query('ntrans'),
            $request->query('linea'),
        );

        if ($finalizar['loan'] === null) {
            $finalizar['loan'] = $finalizarSolicitud->fallbackLoanFromQuery(
                $request->query('monto'),
                $request->query('cuotas'),
                $request->query('nro'),
            );
        }

        $finalizar['regulator'] = $this->resolveRegulatorForLine($finalizar['linea']);

        return Inertia::render('finalizar', [
            'settings'  => $settings,
            'finalizar' => $finalizar,
        ]);
    }

    private function resolveRegulatorForLine(string $linea): ?array
    {
        $shortName = config("finalizar.lines.{$linea}.regulator_short_name");

        if (! is_string($shortName) || trim($shortName) === '') {
            return null;
        }

        $normalizedShortName = Str::lower(trim($shortName));

        try {
            $regulator = Regulator::query()
                ->active()
                ->whereRaw('LOWER(TRIM(short_name)) = ?', [$normalizedShortName])
                ->first();
        } catch (Throwable $exception) {
            Log::warning('No se pudo resolver el convenio para finalizar.', [
                'linea' => $linea,
                'regulator_short_name' => $shortName,
                'exception' => $exception,
            ]);

            return null;
        }

        if (! $regulator) {
            Log::warning('No existe un regulador activo para el convenio de finalizar.', [
                'linea' => $linea,
                'regulator_short_name' => $shortName,
            ]);

            return null;
        }

        return [
            'short_name' => $regulator->short_name,
            'name' => $regulator->name,
            'cuit' => $regulator->cuit,
            'inaes_mat' => $regulator->inaes_mat,
            'logo_url' => $regulator->logo_path
                ? Storage::disk('public')->url($regulator->logo_path)
                : null,
        ];
    }
}
