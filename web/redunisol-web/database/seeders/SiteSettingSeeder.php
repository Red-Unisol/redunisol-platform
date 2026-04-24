<?php

namespace Database\Seeders;

use App\Models\SiteSetting;
use Illuminate\Database\Seeder;

class SiteSettingSeeder extends Seeder
{
    public function run(): void
    {
        $disclaimer = 'El monto mínimo de financiación es de $10,000 y el monto máximo de $5,000,000. El período mínimo para la devolución de un préstamo es de 1 mes y el máximo de 36 meses. El otorgamiento del préstamo está sujeto a evaluación crediticia. Se aplica el tipo de amortización francés con cuotas mensuales y consecutivas. La tasa es fija. Por ejemplo, para un préstamo online solicitado desde el sitio web www.redunisol.com.ar de $150,000 a 12 meses, las tasas aplicables son: Tasa Nominal Anual (TNA) del 69,96%, Tasa Efectiva Anual (TEA) del 95,60%, y el Costo Financiero Total Efectivo Anual (CFTEA) del 108,64%, resultando en una cuota de $20,294,22 y un total a pagar de $243,530.71. En todos los casos, la TNA, TEA y CFTEA serán informados antes de la aceptación de la oferta de préstamo por parte del solicitante. Este ejemplo no constituye obligación alguna para RED UNISOL de ofrecer el precio y el costo aquí informado, ya que la TNA, TEA y CFTEA varían según el perfil crediticio del solicitante y el plazo de financiación elegido. La TNA de un préstamo varía dependiendo del perfil crediticio del solicitante, con una mínima del 69,96% y una máxima del 304,17%. La aprobación definitiva del préstamo quedará supeditada al cumplimiento de las condiciones exigidas por RED UNISOL. La expresión del Costo Financiero Total (Efectivo Anual) responde a una exigencia normativa y su cálculo refleja una operación meramente teórica en la que se capitalizan mensualmente intereses. RED UNISOL, en ningún caso, capitaliza intereses y utiliza el método del interés simple en todos sus cálculos. Los Costos Financieros Totales informados corresponden al cálculo sobre un período mensual promedio de 30 días. CFTEA: 108,64% TNA: 69,96% TEA: 95,60%';

        $settings = [
            ['key' => 'legal_disclaimer',         'value' => $disclaimer],
            ['key' => 'organization_name',         'value' => 'Red Unisol'],
            ['key' => 'organization_description',  'value' => 'Red Unisol es el resultado de un trabajo conjunto de Asociación Mutual Celesol de Servicios Integrales y Educativos y la Asociación Mutual Fiat Concord, que han mancomunado sus visiones y esfuerzos a los efectos de conformar una agrupación de mutuales que conlleve una estructura de servicios mutuales a los socios de ambas entidades.'],
            ['key' => 'contact_email',             'value' => 'info@redunisol.com.ar'],
            ['key' => 'contact_phone',             'value' => ''],
            ['key' => 'contact_address',           'value' => 'Córdoba, Argentina'],
            ['key' => 'facebook_url',              'value' => 'https://www.facebook.com/redunisol'],
            ['key' => 'instagram_url',             'value' => 'https://www.instagram.com/redunisol_prestamos/'],
            ['key' => 'linkedin_url',              'value' => 'https://www.linkedin.com/company/redunisol/'],
            ['key' => 'youtube_url',               'value' => 'https://www.youtube.com/@redunisol5007'],
        ];

        foreach ($settings as $setting) {
            SiteSetting::updateOrCreate(
                ['key' => $setting['key']],
                ['value' => $setting['value']]
            );
        }
    }
}
