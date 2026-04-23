<?php

namespace App\Console\Commands;

use App\Models\Page;
use App\Models\Blog;
use Illuminate\Console\Command;

class ValidateSeo extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'seo:validate {--fix : Automatically fix SEO issues}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Validate and report SEO issues on pages and blogs';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $this->info('🔍 Validating SEO configuration...');
        $this->newLine();

        $issues = [];
        $issues['pages'] = $this->validatePages();
        $issues['blogs'] = $this->validateBlogs();

        $this->displayReport($issues);

        if ($this->option('fix')) {
            $this->fixIssues($issues);
        }

        return 0;
    }

    /**
     * Validate pages SEO fields
     */
    private function validatePages(): array
    {
        $issues = [];
        $pages = Page::all();

        foreach ($pages as $page) {
            $pageIssues = [];

            if (!$page->meta_title) {
                $pageIssues['missing_meta_title'] = true;
            } elseif (strlen($page->meta_title) > 60) {
                $pageIssues['meta_title_too_long'] = strlen($page->meta_title);
            }

            if (!$page->meta_description) {
                $pageIssues['missing_meta_description'] = true;
            } elseif (strlen($page->meta_description) > 160) {
                $pageIssues['meta_description_too_long'] = strlen($page->meta_description);
            }

            if (!$page->keyword) {
                $pageIssues['missing_keyword'] = true;
            }

            if ($pageIssues) {
                $issues[$page->slug] = $pageIssues;
            }
        }

        return $issues;
    }

    /**
     * Validate blogs SEO fields
     */
    private function validateBlogs(): array
    {
        $issues = [];
        $blogs = Blog::all();

        foreach ($blogs as $blog) {
            $blogIssues = [];

            if (!$blog->slug) {
                $blogIssues['missing_slug'] = true;
            }

            if (!$blog->meta_title) {
                $blogIssues['missing_meta_title'] = true;
            } elseif (strlen($blog->meta_title) > 60) {
                $blogIssues['meta_title_too_long'] = strlen($blog->meta_title);
            }

            if (!$blog->meta_description) {
                $blogIssues['missing_meta_description'] = true;
            } elseif (strlen($blog->meta_description) > 160) {
                $blogIssues['meta_description_too_long'] = strlen($blog->meta_description);
            }

            if (!$blog->keyword) {
                $blogIssues['missing_keyword'] = true;
            }

            if ($blogIssues) {
                $issues['Blog: ' . $blog->title] = $blogIssues;
            }
        }

        return $issues;
    }

    /**
     * Display validation report
     */
    private function displayReport(array $issues): void
    {
        $pageIssues = $issues['pages'] ?? [];
        $blogIssues = $issues['blogs'] ?? [];

        $this->line('📄 <info>Pages SEO Report</info>');
        if (empty($pageIssues)) {
            $this->line('  ✅ All pages have proper SEO configuration');
        } else {
            foreach ($pageIssues as $slug => $problems) {
                $this->line("  ❌ <error>{$slug}</error>");
                foreach ($problems as $issue => $value) {
                    if ($value === true) {
                        $this->line("     - Missing: {$issue}");
                    } else {
                        $this->line("     - {$issue}: {$value} characters (max: 60/160)");
                    }
                }
            }
        }

        $this->newLine();
        $this->line('📝 <info>Blogs SEO Report</info>');
        if (empty($blogIssues)) {
            $this->line('  ✅ All blogs have proper SEO configuration');
        } else {
            foreach ($blogIssues as $title => $problems) {
                $this->line("  ❌ <error>{$title}</error>");
                foreach ($problems as $issue => $value) {
                    if ($value === true) {
                        $this->line("     - Missing: {$issue}");
                    } else {
                        $this->line("     - {$issue}: {$value} characters");
                    }
                }
            }
        }

        $this->newLine();
        $totalIssues = count($pageIssues) + count($blogIssues);
        if ($totalIssues === 0) {
            $this->line('✅ <info>No SEO issues found!</info>');
        } else {
            $this->line("⚠️  <error>Found {$totalIssues} item(s) with SEO issues</error>");
        }
    }

    /**
     * Fix SEO issues
     */
    private function fixIssues(array $issues): void
    {
        $this->newLine();
        $this->info('🔧 Fixing SEO issues...');

        $pageIssues = $issues['pages'] ?? [];
        $blogIssues = $issues['blogs'] ?? [];

        foreach ($pageIssues as $slug => $problems) {
            $page = Page::where('slug', $slug)->first();
            if (!$page) continue;

            if (isset($problems['missing_meta_title'])) {
                $page->meta_title = $this->truncate($page->title, 60);
                $this->line("  ✓ Fixed meta_title for: {$slug}");
            }

            if (isset($problems['missing_meta_description'])) {
                $page->meta_description = 'Soluciones de crédito personalizadas para jubilados y policías';
                $this->line("  ✓ Fixed meta_description for: {$slug}");
            }

            if (isset($problems['missing_keyword'])) {
                $page->keyword = strtolower(substr($page->title, 0, 30));
                $this->line("  ✓ Fixed keyword for: {$slug}");
            }

            $page->save();
        }

        foreach ($blogIssues as $title => $problems) {
            $blog = Blog::where('title', str_replace('Blog: ', '', $title))->first();
            if (!$blog) continue;

            if (isset($problems['missing_slug'])) {
                $blog->slug = $this->generateSlug($blog->title);
                $this->line("  ✓ Fixed slug for: {$blog->title}");
            }

            if (isset($problems['missing_meta_title'])) {
                $blog->meta_title = $this->truncate($blog->title, 60);
                $this->line("  ✓ Fixed meta_title for: {$blog->title}");
            }

            if (isset($problems['missing_meta_description'])) {
                $content = strip_tags($blog->content);
                $blog->meta_description = $this->truncate($content, 160);
                $this->line("  ✓ Fixed meta_description for: {$blog->title}");
            }

            if (isset($problems['missing_keyword'])) {
                $blog->keyword = strtolower(substr($blog->title, 0, 30));
                $this->line("  ✓ Fixed keyword for: {$blog->title}");
            }

            $blog->save();
        }

        $this->info('✅ All SEO issues fixed!');
    }

    /**
     * Truncate text to max length
     */
    private function truncate(string $text, int $length): string
    {
        if (strlen($text) <= $length) {
            return $text;
        }

        return substr($text, 0, $length);
    }

    /**
     * Generate URL-friendly slug
     */
    private function generateSlug(string $title): string
    {
        $slug = strtolower($title);
        $slug = preg_replace('/[^a-z0-9]+/', '-', $slug);
        return trim($slug, '-');
    }
}
