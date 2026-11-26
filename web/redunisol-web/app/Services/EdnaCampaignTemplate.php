<?php

namespace App\Services;

use RuntimeException;

/** Business meaning of the approved Edna VENTAS catalogue (subject configured for this application). */
class EdnaCampaignTemplate extends EdnaTemplateButton
{
    public const CUTOVER = 'edna-campaign-templates-v1';

    private const CONSENT = ['Sí, quiero asesoramiento' => 'continue', 'No, gracias' => 'decline'];

    private const OFFER = ['Sí, quiero asesoramiento' => 'offer', 'No, gracias' => 'decline'];

    private const CAJA = ['Sí, quiero conocerlo' => 'offer', 'Consultar más adelante' => 'defer', 'No me interesa' => 'decline'];

    private const WALLET = ['Sí, quiero activarla' => 'benefits', 'Quiero más info' => 'benefits', 'Ahora no' => 'decline'];

    // [Edna matcher name, treatment of an explicitly quoted text/attachment, quick replies].
    // URL buttons open an external page and cannot authorize a WhatsApp transfer.
    private const TEMPLATES = [
        48522 => ['seguimiento_oferta', 'continue', ['Si deseo continuar' => 'continue', 'Ya no me interesa' => 'decline']],
        52791 => ['jubilados_cordoba_', 'continue', ['Enviaré recibo' => 'continue', 'Necesito más info' => 'continue', 'No me interesa' => 'decline']],
        53368 => ['jubilados_cordoba2', 'continue', ['Enviaré Recibo' => 'continue', 'Necesito más Info' => 'continue', 'Ya no me interesa' => 'decline']],
        53579 => ['cbu_video_movimientos', 'continue', ['Continuar con asesor' => 'continue', 'Ya no me interesa' => 'decline']],
        53803 => ['ganados_cordoba_cbu', 'continue', ['Enviaré documentación' => 'continue', 'Necesito más info' => 'continue', 'Ya no me interesa' => 'decline']],
        53882 => ['catamarca_ganado2', 'continue', ['Enviaré recibo' => 'continue', 'Necesito más info' => 'continue', 'Ya no me interesa' => 'decline']],
        54574 => ['seguimiento_oferta_2', 'continue', ['Continuar gestión' => 'continue', 'Tengo dudas' => 'continue', 'No lo quiero' => 'decline']],
        54655 => ['ingreso_basico', 'clarify', []],
        54664 => ['ingreso_cbu', 'continue', []],
        55383 => ['jubilados_cupo', 'clarify', []],
        55623 => ['segui_faltadocu', 'continue', []],
        55625 => ['respuesta_reci', 'continue', []],
        56527 => ['finguru_recepcion2', 'clarify', self::CONSENT],
        57367 => ['formu_fueradehorario', 'link', []],
        57529 => ['ingreso_firma', 'clarify', []],
        57692 => ['respuesta_caja', 'clarify', self::OFFER],
        58130 => ['encuesta_postpropuesta2', 'feedback', []],
        58478 => ['recepcion_consentimiento_ok', 'clarify', ['Sí, quiero asesoramiento' => 'form_consent', 'No, gracias' => 'form_consent']],
        58749 => ['reingreso_consent', 'clarify', self::CONSENT],
        59859 => ['seguimiento_docu2', 'continue', []],
        61263 => ['boton_home', 'link', []],
        61522 => ['acreditacion_resena', 'feedback', []],
        61838 => ['boton_home_atribucion', 'link', []],
        62129 => ['primercontacto_billetera', 'benefits', ['Sí, quiero activarla' => 'benefits', 'Quiero más información' => 'benefits', 'Ahora no' => 'decline']],
        62274 => ['prueba_promo_jubilados_ola1', 'clarify', self::CAJA],
        62276 => ['prueba2_promo_jubilados_ola1', 'clarify', self::CAJA],
        62517 => ['jubilados_300', 'clarify', ['Sí, quiero asesoramiento' => 'clarify', 'No, gracias' => 'decline']], // October-only offer.
        62718 => ['aviso_billetera_v2', 'benefits', ['Si, quiero activarla' => 'benefits', 'Quiero más información' => 'benefits', 'Ahora no' => 'decline']],
        62723 => ['aviso_billetera_v3', 'benefits', self::WALLET],
        62742 => ['seguimiento_billetera_octubre', 'benefits', ['Si, quiero mi regalo' => 'benefits', 'No, gracias' => 'decline']],
        62826 => ['billetera_datos', 'benefits', []],
        63042 => ['aviso_billetera_v4link', 'benefits', self::WALLET],
        63271 => ['aviso_soysocio_v5', 'benefits', ['Darse de baja' => 'unsubscribe']],
        63507 => ['aviso_billetera_v5link', 'benefits', self::WALLET],
        63508 => ['aviso_billetera_v6link', 'benefits', self::WALLET],
        63510 => ['aviso_soysocio_v6final', 'benefits', ['Quiero mis beneficios' => 'benefits', 'Más info' => 'benefits']],
        63977 => ['reactivacion_paii', 'clarify', ['Consultar disponible' => 'offer', 'No me interesa' => 'decline']],
        64262 => ['acreditacion_resena_v2', 'feedback', []],
    ];

    private const QUOTED_TYPES = ['TEXT', 'DOCUMENT', 'IMAGE', 'AUDIO', 'VIDEO'];

    public function candidate(array $payload): bool
    {
        if ($this->id($payload['replyOutMessageId'] ?? null) === null) {
            return false;
        }
        $type = $payload['messageContent']['type'] ?? null;
        if ($type !== 'BUTTON') {
            return in_array($type, self::QUOTED_TYPES, true);
        }
        $opaque = $payload['messageContent']['payload'] ?? null;

        return ! is_string($opaque) || ! str_starts_with($opaque, 'organic:');
    }

    public static function actionFor(array $payload, string $matcherId, string $matcherName): ?string
    {
        $template = self::TEMPLATES[$matcherId] ?? null;
        if (! $template || $template[0] !== $matcherName) {
            return null;
        }
        $content = $payload['messageContent'] ?? [];
        $type = $content['type'] ?? null;
        $text = $content['text'] ?? null;
        if ($type === 'BUTTON') {
            return is_string($text) ? ($template[2][$text] ?? null) : null;
        }
        if (! in_array($type, self::QUOTED_TYPES, true)) {
            return null;
        }
        // Only campaigns explicitly offering a refusal can record a decline from text.
        // A negative survey answer or a response about missing documentation keeps its own context.
        if ($type === 'TEXT' && is_string($text) && (in_array('decline', $template[2], true) || $matcherId === '58478')) {
            $reply = mb_strtolower(trim(trim($text), " \t\n\r.!¡"));
            if (in_array($reply, ['no', 'no gracias', 'no, gracias', 'no me interesa', 'ya no me interesa', 'ahora no', 'no lo quiero'], true)) {
                return 'decline';
            }
        }

        return $template[1];
    }

    public function verifiedReply(array $payload): ?array
    {
        if (! $this->candidate($payload)) {
            return null;
        }
        $message = $this->original($payload);
        $id = $this->id($message['matcherId'] ?? null);
        $name = $message['matcherName'] ?? null;
        $template = self::TEMPLATES[$id] ?? null;
        if (! $template) {
            if (in_array($name, array_column(self::TEMPLATES, 0), true)
                || ($payload['messageContent']['type'] === 'BUTTON' && ($id === null || ! is_string($name) || trim($name) === ''))) {
                throw new RuntimeException('Campaign matcher identity inconsistent.');
            }

            return null;
        }
        if ($template[0] !== $name) {
            throw new RuntimeException('Campaign matcher identity inconsistent.');
        }
        $action = self::actionFor($payload, $id, $name);
        if ($action === null) {
            throw new RuntimeException('Unknown option on a known campaign template.');
        }
        $content = $payload['messageContent'];
        if ($content['type'] === 'BUTTON') {
            $this->verifyButton($message, $content);
        }
        $outbound = $this->receipt($message) + ['matcherName' => $name];
        $result = ['action' => $action];
        if ($action === 'form_consent') {
            // Keep the stronger payload proof used by the existing web form consent route.
            if ($content['payload'] !== $content['text']) {
                throw new RuntimeException('Form consent button not verified.');
            }
            $result['choice'] = $content['text'] === 'Sí, quiero asesoramiento' ? 'yes' : 'no';
        }
        if (in_array($action, ['continue', 'offer', 'clarify'], true) || ($result['choice'] ?? null) === 'yes') {
            $outbound['uniqueAroundSend'] = $this->uniqueAroundSend($outbound, $payload['subscriber']['identifier'], $name);
        }

        return $result + ['outbound' => $outbound];
    }
}
