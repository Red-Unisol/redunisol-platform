<?php

namespace App\Support;

use DOMDocument;
use DOMXPath;
use Illuminate\Support\Str;

final class BlogExcerpt
{
    public static function resolve(?string $excerpt, ?string $content): string
    {
        // Keep valid plain-text summaries exactly as the editor entered them.
        if (trim($excerpt ?? '') !== '' && $excerpt === strip_tags($excerpt) && ! self::containsCss($excerpt)) {
            return $excerpt;
        }

        $text = self::plainText($excerpt ?? '');

        // Imported excerpts may already contain CSS with its <style> tags stripped.
        if ($text === '' || self::containsCss($text)) {
            return self::fromHtml($content ?? '');
        }

        return $text;
    }

    public static function fromHtml(string $content): string
    {
        return Str::limit(self::plainText($content), 160);
    }

    public static function containsCss(string $text): bool
    {
        return preg_match('/[^{}]+\{\s*(?:--)?[a-z-]+\s*:/i', $text) === 1;
    }

    private static function plainText(string $html): string
    {
        if (trim($html) === '') {
            return '';
        }

        $document = new DOMDocument;
        $document->loadHTML(
            '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>'.$html.'</body></html>',
            LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING,
        );
        $xpath = new DOMXPath($document);
        foreach ($xpath->query('//style | //script | //template | //noscript | //iframe | //object | //svg | //head') as $node) {
            $node->parentNode->removeChild($node);
        }
        // Preserve word boundaries between adjacent paragraphs, list items and breaks.
        foreach ($xpath->query('//p | //div | //br | //li | //h1 | //h2 | //h3 | //h4 | //h5 | //h6 | //td | //th') as $node) {
            $node->parentNode->insertBefore($document->createTextNode(' '), $node);
            $node->appendChild($document->createTextNode(' '));
        }

        $body = $document->getElementsByTagName('body')->item(0);

        return trim(preg_replace('/[\s\x{00A0}]+/u', ' ', $body?->textContent ?? '') ?? '');
    }
}
