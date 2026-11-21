<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class LegalDocumentController extends Controller
{
    public function __invoke(Request $request): Response
    {
        $path = '/'.trim($request->path(), '/');
        $document = config('legal_documents', [])[$path] ?? null;
        abort_unless($document, 404);

        return Inertia::render('legal-document', [
            'document' => [
                'title' => $document['title'],
                'description' => $document['description'],
                'content' => file_get_contents(resource_path('legal/'.$document['content'])),
                'pdfUrl' => $document['pdf'],
                'draft' => true,
            ],
            'seo' => [
                'metaTitle' => $document['title'],
                'metaDescription' => $document['description'],
                'robots' => 'noindex, nofollow',
                'canonical' => $request->url(),
            ],
        ]);
    }
}
