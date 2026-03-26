<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class PdfSearchRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'file' => ['required', 'file', 'mimes:pdf', 'max:10240'], // 10MB max
        ];
    }

    /**
     * Get custom messages for validator errors.
     *
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'file.required' => 'El archivo PDF es requerido.',
            'file.file' => 'El campo debe ser un archivo válido.',
            'file.mimes' => 'El archivo debe ser un PDF válido.',
            'file.max' => 'El archivo no debe exceder los 10MB.',
        ];
    }
}
