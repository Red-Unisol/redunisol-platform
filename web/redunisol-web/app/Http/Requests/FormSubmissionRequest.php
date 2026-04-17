<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class FormSubmissionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $trimmed = [];

        foreach ([
            'cuil',
            'email',
            'celular',
            'provincia',
            'situacion_laboral',
            'banco',
            'landing_slug',
            'landing_title',
            'landing_url',
            'recibo_url',
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_term',
            'utm_content',
        ] as $key) {
            $value = $this->input($key);

            if (is_string($value)) {
                $trimmed[$key] = trim($value);
            }
        }

        $this->merge($trimmed);
    }

    public function rules(): array
    {
        return [
            'cuil' => ['nullable', 'string', 'max:32'],
            'email' => ['nullable', 'email:rfc', 'max:255'],
            'celular' => ['nullable', 'string', 'max:32'],
            'provincia' => ['nullable', 'string', 'max:120'],
            'situacion_laboral' => ['nullable', 'string', 'max:120'],
            'banco' => ['nullable', 'string', 'max:255'],
            'terminos' => ['nullable', 'accepted'],
            'landing_slug' => ['required', 'string', 'max:255'],
            'landing_title' => ['nullable', 'string', 'max:255'],
            'landing_url' => ['nullable', 'url', 'max:2048'],
            'recibo_url' => ['nullable', 'url', 'max:2048'],
            'utm_source' => ['nullable', 'string', 'max:120'],
            'utm_medium' => ['nullable', 'string', 'max:120'],
            'utm_campaign' => ['nullable', 'string', 'max:150'],
            'utm_term' => ['nullable', 'string', 'max:150'],
            'utm_content' => ['nullable', 'string', 'max:150'],
        ];
    }

    public function messages(): array
    {
        return [
            'email.email' => 'El email informado no tiene un formato valido.',
            'terminos.accepted' => 'Debes aceptar los terminos para continuar.',
            'landing_slug.required' => 'No se pudo identificar la landing actual.',
            'landing_url.url' => 'La URL de la landing no tiene un formato valido.',
            'recibo_url.url' => 'La URL del recibo no tiene un formato valido.',
        ];
    }
}