<?php

namespace App\Services;

class LegalDocumentService
{
    /** @return array{title: string, description: string, content: string, draft: bool} */
    public function get(string $path): array
    {
        $document = config('legal_documents', [])[$path] ?? null;
        abort_unless($document, 404);

        return [
            'title' => $document['title'],
            'description' => $document['description'],
            'content' => file_get_contents(resource_path('legal/'.$document['content'])),
            'draft' => true,
        ];
    }
}
