<?php

namespace App\Http\Controllers;

use App\Http\Requests\PdfSearchRequest;
use Illuminate\Http\JsonResponse;
use PrinsFrank\PdfParser\PdfParser;

class PdfSearchController extends Controller
{
    /**
     * Handle the incoming request.
     *
     * Search for a 6-8 digit string pattern in the uploaded PDF file.
     */
    public function __invoke(PdfSearchRequest $request): JsonResponse
    {
        $file = $request->file('file');

        try {
            $document = (new PdfParser())->parseFile($file->getPathname());
            $text = $document->getText();

            // Search for a pattern of 6-8 consecutive digits
            $matches = [];
            $found = (bool) preg_match('/\b(\d{6,8})\b/', $text, $matches);

            return response()->json([
                'found' => $found,
                'match' => $found ? $matches[1] : null,
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Error al procesar el archivo PDF.',
                'error' => $e->getMessage(),
            ], 422);
        }
    }
}
