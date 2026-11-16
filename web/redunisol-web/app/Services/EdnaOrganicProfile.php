<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/** Reuses dated client declarations, never a CRM modification date or an old credit decision. */
class EdnaOrganicProfile
{
    private const SITUATIONS = [
        'cordoba' => ['jubilado', 'pensionado', 'empleado_publico', 'policia_cordoba', 'docente', 'salud', 'unc', 'daspu', 'empleado_publico_municipal', 'jubilado_municipal', 'otra'],
        'buenos_aires' => ['jubilado', 'pensionado', 'empleado_publico', 'policia', 'docente', 'otra'],
        'santa_fe' => ['jubilado', 'pensionado', 'empleado_publico', 'policia', 'docente', 'salud', 'otra'],
        'neuquen' => ['jubilado', 'pensionado', 'empleado_publico', 'empleado_publico_municipal', 'policia', 'docente', 'salud', 'otra'],
        'catamarca' => ['jubilado', 'pensionado', 'empleado_publico', 'policia', 'docente', 'salud', 'otra'],
        'caba' => ['jubilado', 'pensionado', 'pfa', 'otra'],
        'otra' => ['jubilado', 'pensionado', 'otra'],
    ];

    private const BANKS = ['bancor', 'nacion', 'otro', 'provincia_bsas', 'santa_fe', 'bpn'];

    private const WEB_FIELDS = ['provincia' => 'UF_CRM_64E65D2B2136C', 'situacion_laboral' => 'UF_CRM_1714071903',
        'banco' => 'UF_CRM_LEAD_1711458190312'];

    private EdnaBitrix $crm;

    private float $deadline;

    private int $calls = 0;

    private ?array $webEnums = null;

    public function __construct(?EdnaBitrix $crm = null)
    {
        $this->crm = $crm ?? new EdnaBitrix;
    }

    public function completeAnswer(array $input): ?array
    {
        $province = $input['provincia'] ?? null;
        if (! is_string($province) || ! isset(self::SITUATIONS[$province])) {
            return null;
        }
        $situation = $input['situacion_'.$province] ?? null;
        $cuil = preg_replace('/[\s.\-]/', '', is_string($input['cuil'] ?? null) ? $input['cuil'] : '');
        if (! in_array($situation, self::SITUATIONS[$province], true) || ! $this->validCuil($cuil)) {
            return null;
        }
        $answer = ['provincia' => $province, 'situacion_'.$province => $situation, 'cuil' => $cuil];
        $retired = in_array($situation, ['jubilado', 'pensionado'], true);
        $organismKey = $province === 'cordoba' ? 'organismo' : 'organismo_'.$province;
        $organism = $input[$organismKey] ?? '';
        if ($retired) {
            if (! in_array($organism, ['anses', $province === 'cordoba' ? 'caja_cordoba' : 'caja_provincial'], true)) {
                return null;
            }
            $answer[$organismKey] = $organism;
        }
        $bankKey = $province === 'cordoba' && $retired ? 'banco_jubilado' : 'banco_'.$province;
        if (! ($retired && $organism === 'caja_cordoba' && $situation !== 'pensionado')) {
            if (! in_array($input[$bankKey] ?? null, self::BANKS, true)) {
                return null;
            }
            $answer[$bankKey] = $input[$bankKey];
        }
        $email = is_string($input['email'] ?? null) ? trim($input['email']) : '';
        if ($email !== '' && (! filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254)) {
            return null;
        }
        if ($email !== '') {
            $answer['email'] = strtolower($email);
        }

        return $answer;
    }

    public function record(string $sourceKind, string $sourceId, string $phone, array $input, mixed $confirmedAt, ?string $leadId = null, ?string $contactId = null): bool
    {
        $answer = $this->completeAnswer($input);
        $hash = (new AttributionJourney)->phoneHash($phone);
        if (! $answer || ! $hash || ! in_array($sourceKind, ['edna_intake_request', 'web_form'], true)
            || $sourceId === '' || strlen($sourceId) > 64) {
            return false;
        }
        if (! $confirmedAt) {
            return false;
        }
        try {
            $date = CarbonImmutable::parse($confirmedAt);
        } catch (Throwable) {
            return false;
        }
        if ($date->gt(now()->addMinutes(5))) {
            return false;
        }

        // A retry cannot refresh the declaration timestamp or silently change an identity.
        return (bool) DB::table('edna_customer_profiles')->insertOrIgnore([
            'source_kind' => $sourceKind, 'source_id' => $sourceId, 'phone_hash' => $hash,
            'identity_hash' => (new WebFormReceipt)->identityHash($answer['cuil']),
            'answer' => Crypt::encryptString(json_encode($answer, JSON_THROW_ON_ERROR)),
            'confirmed_at' => $date, 'lead_id' => $leadId, 'contact_id' => $contactId,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function websiteAnswer(array $input): ?array
    {
        $ascii = fn ($value) => strtolower(trim(Str::ascii(is_string($value) ? $value : '')));
        $province = ['cordoba' => 'cordoba', 'buenos aires' => 'buenos_aires', 'santa fe' => 'santa_fe',
            'neuquen' => 'neuquen', 'catamarca' => 'catamarca', 'caba' => 'caba', 'otros' => 'otra', 'otra' => 'otra'][$ascii($input['provincia'] ?? '')] ?? null;
        if (! $province) {
            return null;
        }
        $employment = $ascii($input['situacion_laboral'] ?? '');
        $situation = ['empleado publico provincial' => 'empleado_publico', 'empleado publico municipal' => 'empleado_publico_municipal',
            'jubilado municipal' => 'jubilado_municipal', 'docente' => 'docente', 'personal de salud' => 'salud',
            'empleado de la unc' => 'unc', 'daspu' => 'daspu', 'policia federal' => 'pfa',
            'policia' => $province === 'cordoba' ? 'policia_cordoba' : 'policia',
            'jubilado nacional' => 'jubilado', 'jubilado provincial' => 'jubilado', 'otra' => 'otra'][$employment] ?? null;
        // "Pensionado" alone does not prove ANSES vs. a provincial source.
        if (! $situation) {
            return null;
        }
        $answer = ['provincia' => $province, 'situacion_'.$province => $situation, 'cuil' => $input['cuil'] ?? '', 'email' => $input['email'] ?? ''];
        if ($situation === 'jubilado') {
            $answer[$province === 'cordoba' ? 'organismo' : 'organismo_'.$province] = $employment === 'jubilado nacional'
                ? 'anses' : ($province === 'cordoba' ? 'caja_cordoba' : 'caja_provincial');
        }
        $bank = ['banco de la provincia de cordoba s.a.' => 'bancor', 'bancor' => 'bancor',
            'banco de la nacion argentina' => 'nacion', 'banco nacion' => 'nacion',
            'banco de la provincia de buenos aires' => 'provincia_bsas',
            'nuevo banco de santa fe sociedad anonima' => 'santa_fe', 'banco provincia del neuquen sociedad anonima' => 'bpn',
            'otros' => 'otro', 'otro' => 'otro'][$ascii($input['banco'] ?? '')] ?? null;
        $answer[$province === 'cordoba' && $situation === 'jubilado' ? 'banco_jubilado' : 'banco_'.$province] = $bank;

        return $this->completeAnswer($answer);
    }

    /** The native message is already proven by the menu worker; CRM reads only identify its saved profile. */
    public function resolve(object $menu, array $proof): array
    {
        $this->deadline = microtime(true) + 40;
        $this->calls = 0;
        $this->webEnums = null;
        try {
            $phone = Crypt::decryptString($menu->recipient);
            $hash = (new AttributionJourney)->phoneHash($phone);
            if (! $hash || $hash !== $menu->phone_hash || (string) $menu->subject_id !== (string) config('edna.subject_id')
                || ($proof['verified'] ?? false) !== true || ($proof['source'] ?? '') !== 'bitrix_openline_session') {
                return ['status' => 'ambiguous', 'reason' => 'profile_entry_identity_invalid'];
            }
            $months = (int) config('edna.organic_profile_max_age_months', 6);
            if ($months < 1 || $months > 24) {
                return ['status' => 'pending', 'reason' => 'profile_age_policy_invalid'];
            }
            $cutoff = CarbonImmutable::now()->subMonthsNoOverflow($months);
            $candidates = [];
            $saved = DB::table('edna_customer_profiles')->where('phone_hash', $hash)->where('confirmed_at', '>', $cutoff)->orderByDesc('confirmed_at')->limit(101)->get();
            if ($saved->count() > 100) {
                return ['status' => 'ambiguous', 'reason' => 'profile_declaration_window_incomplete'];
            }
            foreach ($saved as $row) {
                $this->candidate($candidates, $row->source_kind, $row->source_id, json_decode(Crypt::decryptString($row->answer), true, 32, JSON_THROW_ON_ERROR),
                    $row->confirmed_at, $row->lead_id, $row->contact_id, $cutoff);
            }
            $previous = DB::table('edna_intake_requests as r')->join('edna_flow_sends as s', 's.id', '=', 'r.flow_send_id')
                ->join('edna_intake_admissions as a', 'a.id', '=', 's.intake_admission_id')->where('a.recipient_hash', $hash)
                ->where('s.subject_id', $menu->subject_id)->where('r.state', 'synced')->whereNotNull('r.answer')
                ->where('r.received_at', '>=', $cutoff)->orderByDesc('r.received_at')->limit(101)
                ->get(['r.id', 'r.answer', 'r.received_at', 'r.lead_id', 'r.contact_id']);
            foreach ($previous as $row) {
                $this->candidate($candidates, 'edna_intake_request', (string) $row->id, json_decode(Crypt::decryptString($row->answer), true, 32, JSON_THROW_ON_ERROR),
                    $row->received_at, $row->lead_id, $row->contact_id, $cutoff);
            }
            if ($previous->count() > 100) {
                return ['status' => 'ambiguous', 'reason' => 'profile_declaration_window_incomplete'];
            }
            $nativeLead = null;
            $nativeIdentity = null;
            if (preg_match('/^[1-9][0-9]*$/D', (string) ($proof['native_lead_id'] ?? ''))) {
                $nativeLead = $this->call('crm.lead.get', ['id' => $proof['native_lead_id']]);
                if ((string) ($nativeLead['ID'] ?? '') !== (string) $proof['native_lead_id']) {
                    throw new RuntimeException('Native profile identity unavailable.');
                }
                $nativeIdentity = $this->validCuil((string) ($nativeLead['UF_CRM_1693840106704'] ?? ''))
                    ? (new WebFormReceipt)->identityHash($nativeLead['UF_CRM_1693840106704']) : null;
            }
            $allIdentities = [];
            if (! empty($proof['contact_id'])) {
                $nativeContact = $this->call('crm.contact.get', ['id' => $proof['contact_id']]);
                if ((string) ($nativeContact['ID'] ?? '') !== (string) $proof['contact_id']) {
                    throw new RuntimeException('Native contact unavailable.');
                }
                $cuil = (string) ($nativeContact['UF_CRM_65B7E48033FCD'] ?? '');
                if ($this->validCuil($cuil)) {
                    $contactIdentity = (new WebFormReceipt)->identityHash($cuil);
                    if ($nativeIdentity && $nativeIdentity !== $contactIdentity) {
                        return ['status' => 'ambiguous', 'reason' => 'profile_native_contact_conflict'];
                    }
                    $nativeIdentity = $contactIdentity;
                }
            }
            foreach (['LEAD' => 'lead', 'CONTACT' => 'contact'] as $kind => $entity) {
                $duplicates = $this->call('crm.duplicate.findbycomm', ['entity_type' => $kind, 'type' => 'PHONE', 'values' => [$phone]]);
                $ids = $duplicates[$kind] ?? [];
                if (! is_array($duplicates) || ! is_array($ids) || count($ids) > 100 || collect($ids)->contains(fn ($id) => ! preg_match('/^[1-9][0-9]*$/D', (string) $id))) {
                    return ['status' => 'ambiguous', 'reason' => 'profile_phone_candidates_ambiguous'];
                }
                foreach (array_chunk($ids, 50) as $batch) {
                    $fields = ['ID', 'CONTACT_ID', 'PHONE', 'EMAIL', 'UF_CRM_1693840106704', 'UF_CRM_65B7E48033FCD',
                        'UF_CRM_WA_TIMESTAMP', 'UF_CRM_WA_PROVINCE', 'UF_CRM_WA_SEGMENT', 'UF_CRM_WA_ORGANISMO', 'UF_CRM_WA_BANCO', 'UF_CRM_WA_FLOW', 'UF_CRM_WA_FLOW_ID'];
                    if ($entity === 'lead') {
                        array_push($fields, ...array_values(self::WEB_FIELDS));
                    }
                    $rows = $this->call('crm.'.$entity.'.list', ['filter' => ['@ID' => $batch], 'select' => $fields, 'start' => -1]);
                    if (! is_array($rows) || ! array_is_list($rows) || count($rows) !== count($batch)) {
                        throw new RuntimeException('Profile response incomplete.');
                    }
                    foreach ($rows as $record) {
                        if (! in_array((string) ($record['ID'] ?? ''), array_map('strval', $batch), true)
                            || ! collect($record['PHONE'] ?? [])->contains(fn ($p) => (new AttributionJourney)->phoneHash((string) ($p['VALUE'] ?? '')) === $hash)) {
                            return ['status' => 'ambiguous', 'reason' => 'profile_crm_phone_changed'];
                        }
                        $cuil = (string) ($record[$entity === 'lead' ? 'UF_CRM_1693840106704' : 'UF_CRM_65B7E48033FCD'] ?? '');
                        if ($this->validCuil($cuil)) {
                            $allIdentities[(new WebFormReceipt)->identityHash($cuil)] = true;
                        }
                        if ($entity !== 'lead') {
                            if ((string) ($nativeLead['CONTACT_ID'] ?? '') === (string) $record['ID'] && $this->validCuil($cuil)) {
                                $contactIdentity = (new WebFormReceipt)->identityHash($cuil);
                                if ($nativeIdentity && $nativeIdentity !== $contactIdentity) {
                                    return ['status' => 'ambiguous', 'reason' => 'profile_native_contact_conflict'];
                                }
                                $nativeIdentity = $contactIdentity;
                            }

                            continue;
                        }
                        $answer = $this->crmAnswer($record);
                        if ($answer && ! empty($record['UF_CRM_WA_TIMESTAMP'])) {
                            $this->candidate($candidates, 'crm_verified_profile', (string) $record['ID'], $answer,
                                $record['UF_CRM_WA_TIMESTAMP'], (string) $record['ID'], $record['CONTACT_ID'] ?? null, $cutoff);
                        } elseif ($answer === null) {
                            $this->historicalWebCandidates($candidates, $record, $hash, $cutoff);
                        }
                    }
                }
            }
            foreach ($candidates as $candidate) {
                $allIdentities[$candidate['identity_hash']] = true;
            }
            if (! $nativeIdentity && count($allIdentities) > 1) {
                return ['status' => 'ambiguous', 'reason' => 'profile_phone_has_multiple_identities'];
            }
            if ($nativeIdentity) {
                $candidates = array_values(array_filter($candidates, fn ($candidate) => $candidate['identity_hash'] === $nativeIdentity));
            }
            if (! $candidates) {
                return ['status' => 'missing', 'reason' => 'complete_recent_profile_unavailable'];
            }
            usort($candidates, fn ($a, $b) => strcmp($b['provenance']['confirmed_at'], $a['provenance']['confirmed_at']));
            $chosen = $candidates[0];
            foreach ($candidates as $candidate) {
                if ($candidate['provenance']['confirmed_at'] === $chosen['provenance']['confirmed_at'] && $candidate['answer'] !== $chosen['answer']) {
                    return ['status' => 'ambiguous', 'reason' => 'profile_declarations_conflict'];
                }
            }

            return ['status' => 'reusable', 'reason' => 'complete_recent_profile_confirmed', ...$chosen];
        } catch (Throwable) {
            return ['status' => 'pending', 'reason' => 'profile_source_unavailable'];
        }
    }

    public function crmAnswer(array $record): ?array
    {
        if (! in_array($record['UF_CRM_WA_FLOW'] ?? '', ['whatsapp_intake', 'web_whatsapp_intake', 'organic_profile_reuse'], true)) {
            return null;
        }
        $province = $record['UF_CRM_WA_PROVINCE'] ?? '';
        $segment = $record['UF_CRM_WA_SEGMENT'] ?? '';
        if (! is_string($province) || ! is_string($segment) || ! str_starts_with($segment, $province.'_')) {
            return null;
        }
        $situation = substr($segment, strlen($province) + 1);
        if ($segment === 'otra_provincia') {
            $situation = 'otra';
        }
        if (in_array($record['UF_CRM_WA_FLOW_ID'] ?? '', ['3298964390491520', '995212369590508'], true)
            && in_array($situation, ['jubilado', 'pensionado'], true)) {
            return null; // Legacy grouped benefits cannot establish the V3 distinction.
        }
        $answer = ['provincia' => $province, 'situacion_'.$province => $situation, 'cuil' => $record['UF_CRM_1693840106704'] ?? '',
            'email' => $record['EMAIL'][0]['VALUE'] ?? ''];
        $retired = in_array($situation, ['jubilado', 'pensionado'], true);
        if ($retired) {
            $answer[$province === 'cordoba' ? 'organismo' : 'organismo_'.$province] = $record['UF_CRM_WA_ORGANISMO'] ?? '';
        }
        $answer[$province === 'cordoba' && $retired ? 'banco_jubilado' : 'banco_'.$province] = $record['UF_CRM_WA_BANCO'] ?? '';

        return $this->completeAnswer($answer);
    }

    public function stillCurrent(object $menu, array $answer, array $provenance, array $nativeSnapshot): bool
    {
        $this->deadline = microtime(true) + 10;
        $this->calls = 0;
        $this->webEnums = null;
        $complete = $this->completeAnswer($answer);
        $date = CarbonImmutable::parse($provenance['confirmed_at'] ?? '0001-01-01');
        $cutoff = CarbonImmutable::now()->subMonthsNoOverflow((int) config('edna.organic_profile_max_age_months', 6));
        if (! $complete || $date->lte($cutoff) || $date->gt(now()->addMinutes(5))
            || $date->gt(CarbonImmutable::parse($menu->choice_received_at)->addMinutes(5))) {
            return false;
        }
        $identity = (new WebFormReceipt)->identityHash($complete['cuil']);
        foreach ($nativeSnapshot['records'] ?? [] as $record) {
            if (! empty($record['identity_hash']) && $record['identity_hash'] !== $identity) {
                return false;
            }
        }
        if (($provenance['source_kind'] ?? '') === 'crm_verified_profile') {
            $lead = $this->call('crm.lead.get', ['id' => $provenance['source_id']]);

            return (string) ($lead['ID'] ?? '') === (string) $provenance['source_id']
                && $this->crmAnswer($lead) === $complete
                && CarbonImmutable::parse($lead['UF_CRM_WA_TIMESTAMP'] ?? '0001-01-01')->equalTo($date)
                && collect($lead['PHONE'] ?? [])->contains(fn ($phone) => (new AttributionJourney)->phoneHash((string) ($phone['VALUE'] ?? '')) === $menu->phone_hash);
        }
        if (! in_array($provenance['source_kind'] ?? '', ['edna_intake_request', 'web_form'], true)) {
            return false;
        }
        $saved = DB::table('edna_customer_profiles')->where('source_kind', $provenance['source_kind'])
            ->where('source_id', $provenance['source_id'])->where('phone_hash', $menu->phone_hash)->first();
        $newer = DB::table('edna_customer_profiles')->where('phone_hash', $menu->phone_hash)->where('confirmed_at', '>', $date)->exists();
        if ($newer) {
            return false;
        }
        if ($saved) {
            return $saved->identity_hash === $identity && CarbonImmutable::parse($saved->confirmed_at)->equalTo($date)
                && $this->completeAnswer(json_decode(Crypt::decryptString($saved->answer), true, 32, JSON_THROW_ON_ERROR)) === $complete;
        }
        if ($provenance['source_kind'] === 'edna_intake_request') {
            $request = DB::table('edna_intake_requests as r')->join('edna_flow_sends as s', 's.id', '=', 'r.flow_send_id')
                ->where('r.id', $provenance['source_id'])->where('r.state', 'synced')->whereNotNull('r.answer')
                ->get(['r.answer', 'r.received_at', 's.recipient', 's.subject_id'])->first();

            return $request && $request->subject_id === $menu->subject_id
                && (new AttributionJourney)->phoneHash(Crypt::decryptString($request->recipient)) === $menu->phone_hash
                && CarbonImmutable::parse($request->received_at)->equalTo($date)
                && $this->completeAnswer(json_decode(Crypt::decryptString($request->answer), true, 32, JSON_THROW_ON_ERROR)) === $complete;
        }

        if ($provenance['source_kind'] === 'web_form') {
            return $this->historicalWebCurrent($menu, $complete, $provenance, $identity, $date);
        }

        return false;
    }

    private function historicalWebCandidates(array &$candidates, array $record, string $phoneHash, CarbonImmutable $cutoff): void
    {
        $cuil = (string) ($record['UF_CRM_1693840106704'] ?? '');
        if (! $this->validCuil($cuil)) {
            return;
        }
        $receipts = DB::table('web_form_receipts')->where('state', 'synced')->where('source', 'web_server')
            ->where('lead_id', (string) $record['ID'])->where('phone_hash', $phoneHash)
            ->where('identity_hash', (new WebFormReceipt)->identityHash($cuil))
            ->where('received_at', '>', $cutoff)->orderByDesc('received_at')->limit(101)
            ->get(['id', 'lead_id', 'contact_id', 'received_at']);
        if ($receipts->isEmpty()) {
            return;
        }
        if ($receipts->count() > 100 || count($candidates) + $receipts->count() > 100) {
            throw new RuntimeException('Historical web declaration window incomplete.');
        }
        $profile = $this->webCrmProfile($record);
        if ($profile === null) {
            return;
        }
        foreach ($receipts as $receipt) {
            if (! Str::isUuid($receipt->id) || ($receipt->contact_id
                && (string) $receipt->contact_id !== (string) ($record['CONTACT_ID'] ?? ''))) {
                continue;
            }
            $count = count($candidates);
            $this->candidate($candidates, 'web_form', $receipt->id, $profile['answer'], $receipt->received_at,
                (string) $record['ID'], $receipt->contact_id, $cutoff);
            if (count($candidates) > $count) {
                $candidates[$count]['provenance'] += ['web_lead_id' => (string) $receipt->lead_id,
                    'web_contact_id' => $receipt->contact_id, 'web_fields_hash' => $profile['fields_hash']];
            }
        }
    }

    private function historicalWebCurrent(object $menu, array $answer, array $provenance, string $identity, CarbonImmutable $date): bool
    {
        if (! Str::isUuid($provenance['source_id'] ?? '')
            || ! preg_match('/^[1-9][0-9]*$/D', (string) ($provenance['web_lead_id'] ?? ''))
            || ! preg_match('/^[a-f0-9]{64}$/D', (string) ($provenance['web_fields_hash'] ?? ''))) {
            return false;
        }
        $receipt = DB::table('web_form_receipts')->where('id', $provenance['source_id'])
            ->where('state', 'synced')->where('source', 'web_server')->where('phone_hash', $menu->phone_hash)
            ->where('identity_hash', $identity)->where('lead_id', $provenance['web_lead_id'])->first();
        if (! $receipt || ! CarbonImmutable::parse($receipt->received_at)->equalTo($date)
            || (string) $receipt->contact_id !== (string) ($provenance['web_contact_id'] ?? '')
            || DB::table('web_form_receipts')->where('phone_hash', $menu->phone_hash)->where('state', 'synced')
                ->where('source', 'web_server')->where('received_at', '>', $date)->exists()) {
            return false;
        }
        $lead = $this->call('crm.lead.get', ['id' => $receipt->lead_id]);
        if (! is_array($lead) || (string) ($lead['ID'] ?? '') !== (string) $receipt->lead_id
            || ($receipt->contact_id && (string) ($lead['CONTACT_ID'] ?? '') !== (string) $receipt->contact_id)
            || (new WebFormReceipt)->identityHash((string) ($lead['UF_CRM_1693840106704'] ?? '')) !== $identity
            || ! collect($lead['PHONE'] ?? [])->contains(fn ($phone) => (new AttributionJourney)->phoneHash((string) ($phone['VALUE'] ?? '')) === $menu->phone_hash)) {
            return false;
        }
        $profile = $this->webCrmProfile($lead);

        return $profile !== null && $profile['answer'] === $answer
            && hash_equals($provenance['web_fields_hash'], $profile['fields_hash']);
    }

    private function webCrmProfile(array $record): ?array
    {
        foreach (self::WEB_FIELDS as $field) {
            if ((! is_string($record[$field] ?? null) && ! is_int($record[$field] ?? null))
                || ! preg_match('/^[1-9][0-9]*$/D', (string) $record[$field])) {
                return null;
            }
        }
        if ($this->webEnums === null) {
            $schema = $this->call('crm.lead.fields', []);
            $maps = [];
            foreach (self::WEB_FIELDS as $field) {
                $meta = is_array($schema) ? ($schema[$field] ?? null) : null;
                if (! is_array($meta) || ($meta['type'] ?? '') !== 'enumeration' || ($meta['isMultiple'] ?? false) !== false
                    || ! is_array($meta['items'] ?? null) || ! array_is_list($meta['items']) || $meta['items'] === [] || count($meta['items']) > 2000) {
                    throw new RuntimeException('Web declaration field schema incomplete.');
                }
                foreach ($meta['items'] as $item) {
                    if (! is_array($item) || (! is_string($item['ID'] ?? null) && ! is_int($item['ID'] ?? null))
                        || ! preg_match('/^[1-9][0-9]*$/D', (string) $item['ID']) || isset($maps[$field][(string) $item['ID']])
                        || ! is_string($item['VALUE'] ?? null) || trim($item['VALUE']) === '' || strlen($item['VALUE']) > 512) {
                        throw new RuntimeException('Web declaration field schema ambiguous.');
                    }
                    $maps[$field][(string) $item['ID']] = $item['VALUE'];
                }
            }
            $this->webEnums = $maps;
        }
        $labels = [];
        $fields = [];
        foreach (self::WEB_FIELDS as $name => $field) {
            $id = (string) $record[$field];
            if (! isset($this->webEnums[$field][$id])) {
                return null;
            }
            $labels[$name] = $this->webEnums[$field][$id];
            $fields[$field] = ['id' => $id, 'label' => $labels[$name]];
        }
        $answer = $this->websiteAnswer($labels + ['cuil' => $record['UF_CRM_1693840106704'] ?? '', 'email' => $record['EMAIL'][0]['VALUE'] ?? '']);

        return $answer === null ? null : ['answer' => $answer, 'fields_hash' => hash('sha256', json_encode($fields, JSON_THROW_ON_ERROR))];
    }

    private function candidate(array &$rows, string $kind, string $id, mixed $input, mixed $confirmedAt, ?string $leadId, ?string $contactId, CarbonImmutable $cutoff): void
    {
        $answer = is_array($input) ? $this->completeAnswer($input) : null;
        if (! $answer) {
            return;
        }
        $date = CarbonImmutable::parse($confirmedAt);
        if ($date->lte($cutoff) || $date->gt(now()->addMinutes(5))) {
            return;
        }
        $rows[] = ['answer' => $answer, 'identity_hash' => (new WebFormReceipt)->identityHash($answer['cuil']),
            'contact_id' => $contactId, 'lead_id' => $leadId,
            'provenance' => ['source_kind' => $kind, 'source_id' => $id, 'confirmed_at' => $date->utc()->toIso8601String(),
                'schema' => 'whatsapp-intake-v3', 'v3_equivalent' => true]];
    }

    private function validCuil(string $cuil): bool
    {
        if (! preg_match('/^[0-9]{11}$/D', $cuil) || count(array_unique(str_split($cuil))) === 1) {
            return false;
        }
        $weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
        $sum = 0;
        foreach ($weights as $i => $weight) {
            $sum += (int) $cuil[$i] * $weight;
        }
        $digit = 11 - ($sum % 11);

        return (int) $cuil[10] === ($digit === 11 ? 0 : ($digit === 10 ? 9 : $digit));
    }

    private function call(string $method, array $params): mixed
    {
        if (++$this->calls > 16 || microtime(true) >= $this->deadline) {
            throw new RuntimeException('Profile lookup budget exhausted.');
        }

        return $this->crm->call($method, $params);
    }
}
