<?php

namespace App\Http\Controllers;

use App\Services\LegalDocumentService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class LegalDocumentController extends Controller
{
    public function __invoke(Request $request, LegalDocumentService $documents): Response
    {
        $path = '/'.trim($request->path(), '/');
        $document = $documents->get($path);

        return Inertia::render('legal-document', [
            'document' => $document,
            'seo' => [
                'metaTitle' => $document['title'],
                'metaDescription' => $document['description'],
                'robots' => 'noindex, nofollow',
                'canonical' => $request->url(),
            ],
        ]);
    }
}
