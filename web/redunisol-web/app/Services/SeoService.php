<?php

namespace App\Services;

use App\Models\Page;
use App\Models\Blog;

class SeoService
{
    /**
     * Generate meta title for a page
     */
    public function generateMetaTitle(Page|Blog $model, int $maxLength = 60): string
    {
        if ($model->meta_title) {
            return $this->truncate($model->meta_title, $maxLength);
        }

        $appName = config('app.name', 'RedúniSol');
        $title = $this->truncate($model->title, $maxLength - strlen($appName) - 3);

        return "{$title} | {$appName}";
    }

    /**
     * Generate meta description for a page
     */
    public function generateMetaDescription(Page|Blog $model, int $maxLength = 160): string
    {
        if ($model->meta_description) {
            return $this->truncate($model->meta_description, $maxLength);
        }

        $description = '';
        if ($model instanceof Blog && $model->content) {
            $description = strip_tags($model->content);
        } elseif ($model instanceof Page) {
            $description = "Soluciones de crédito personalizadas para jubilados y policías";
        }

        return $this->truncate($description ?: $model->title, $maxLength);
    }

    /**
     * Generate robots meta tag
     */
    public function getRobotsTag(Page|Blog $model): string
    {
        if (!$model->index) {
            return 'noindex, nofollow';
        }

        return 'index, follow';
    }

    /**
     * Truncate text to a maximum length
     */
    public function truncate(string $text, int $length = 160): string
    {
        if (strlen($text) <= $length) {
            return $text;
        }

        $truncated = substr($text, 0, $length);
        $truncated = preg_replace('/\s+?(\S+)?$/', '', $truncated);

        return $truncated . '...';
    }

    /**
     * Generate canonical URL
     */
    public function getCanonicalUrl(Page|Blog $model): string
    {
        $baseUrl = rtrim(config('app.url'), '/');

        if ($model instanceof Page) {
            return $baseUrl . $model->slug;
        }

        if ($model instanceof Blog && $model->slug) {
            return $baseUrl . '/blog/' . $model->slug;
        }

        return $baseUrl;
    }

    /**
     * Get structured data for a page
     */
    public function getStructuredData(Page|Blog $model): array
    {
        $canonical = $this->getCanonicalUrl($model);

        return [
            '@context' => 'https://schema.org',
            '@type' => $model instanceof Blog ? 'BlogPosting' : 'WebPage',
            'headline' => $this->generateMetaTitle($model),
            'description' => $this->generateMetaDescription($model),
            'url' => $canonical,
            'author' => [
                '@type' => 'Organization',
                'name' => config('app.name', 'RedúniSol'),
            ],
        ];
    }

    /**
     * Validate SEO fields
     */
    public function validateSeoFields(array $data): array
    {
        $errors = [];

        if (isset($data['meta_title']) && strlen($data['meta_title']) > 60) {
            $errors['meta_title'] = 'El meta title no debe exceder 60 caracteres';
        }

        if (isset($data['meta_description']) && strlen($data['meta_description']) > 160) {
            $errors['meta_description'] = 'La meta description no debe exceder 160 caracteres';
        }

        if (isset($data['keyword']) && empty($data['keyword'])) {
            $errors['keyword'] = 'Ingresa una palabra clave principal';
        }

        return $errors;
    }
}
