<?php

namespace Database\Seeders;

use App\Models\Blog;
use App\Models\Category;
use App\Models\User;
use App\Support\BlogExcerpt;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ScrapedBlogsSeeder extends Seeder
{
    public function run(): void
    {
        $path = database_path('seeders/scraped_seed.json');

        if (! file_exists($path)) {
            $this->command->warn("No scraped seed file found at {$path}. Run the scraper first to generate it.");

            return;
        }

        $json = json_decode(file_get_contents($path), true);
        if (! $json || ! isset($json['items'])) {
            $this->command->error('Invalid JSON structure in scraped_seed.json');

            return;
        }

        // ensure we have an author to attach to blogs (migration requires non-null author_id)
        $defaultEmail = env('ADMIN_EMAIL', 'admin@solva.ar');
        $author = User::where('email', $defaultEmail)->first() ?? User::first();
        if (! $author) {
            // create a fallback importer user
            $author = User::create([
                'name' => 'Importer',
                'email' => 'importer@local',
                'password' => Hash::make(Str::random(16)),
            ]);
        }
        $authorId = $author->id;

        foreach ($json['items'] as $item) {
            if (isset($item['error'])) {
                $this->command->warn("Skipping {$item['slug']}: error in scraping ({$item['error']})");

                continue;
            }

            $slug = $item['slug'] ?? null;
            if (! $slug) {
                $this->command->warn('Skipping entry with missing slug');

                continue;
            }

            $slug = ltrim($slug, '/');
            $title = $item['title'] ?? $slug;

            $content = $item['content_html'] ?? ($item['content_text'] ?? '');
            $excerpt = BlogExcerpt::fromHtml($content);

            $published_at = null;
            if (! empty($item['published_at'])) {
                try {
                    $published_at = Carbon::parse($item['published_at']);
                } catch (\Exception $e) {
                    $published_at = null;
                }
            }

            $blogData = [
                'title' => $title,
                'slug' => $slug,
                'content' => $content,
                'excerpt' => $excerpt,
                'image' => null, // will set after optionally downloading
                'author_id' => $authorId,
                'meta_title' => $item['title'] ?? null,
                'meta_description' => $item['description'] ?? $excerpt,
                'keyword' => null,
                'index' => true,
                'author_display' => $item['author'] ?? null,
                'published_at' => $published_at,
            ];

            $blog = Blog::updateOrCreate(['slug' => $slug], $blogData);

            // Handle images: try to download first reachable image and store in public disk
            // Prefer thumbnail field from scraper
            $imgCandidates = [];
            if (! empty($item['thumbnail'])) {
                $imgCandidates[] = $item['thumbnail'];
            }
            if (! empty($item['images']) && is_array($item['images'])) {
                $imgCandidates = array_merge($imgCandidates, $item['images']);
            }

            if (! empty($imgCandidates)) {
                $downloaded = false;
                foreach ($imgCandidates as $imgUrl) {
                    if (! $imgUrl) {
                        continue;
                    }
                    try {
                        $contents = @file_get_contents($imgUrl);
                        if ($contents === false) {
                            continue;
                        }

                        $ext = pathinfo(parse_url($imgUrl, PHP_URL_PATH), PATHINFO_EXTENSION);
                        $ext = $ext ? preg_replace('/[^a-zA-Z0-9]/', '', $ext) : 'jpg';
                        $filename = 'blogs/'.$slug.'-'.time().'.'.$ext;

                        // store in public disk
                        Storage::disk('public')->put($filename, $contents);

                        $blog->image = $filename;
                        $blog->save();
                        $downloaded = true;
                        $this->command->info("Downloaded image for {$slug}: {$filename}");
                        break;
                    } catch (\Exception $e) {
                        // ignore and try next
                        continue;
                    }
                }
                if (! $downloaded) {
                    $this->command->warn("No images could be downloaded for {$slug}");
                }
            }

            // Match tags to categories and attach (fuzzy matching)
            $allCategories = Category::all();
            $attachedCats = [];

            // try matching provided tags first
            $providedTags = ! empty($item['tags']) && is_array($item['tags']) ? $item['tags'] : [];
            foreach ($providedTags as $t) {
                $tNorm = trim((string) $t);
                if ($tNorm === '') {
                    continue;
                }
                $tLower = mb_strtolower($tNorm);
                // exact name or slug
                $cat = $allCategories->first(function ($c) use ($tLower, $tNorm) {
                    return mb_strtolower($c->name) === $tLower || $c->slug === Str::slug($tNorm);
                });
                if (! $cat) {
                    // substring matches
                    $cat = $allCategories->first(function ($c) use ($tLower) {
                        $nameLower = mb_strtolower($c->name);

                        return mb_strpos($tLower, $nameLower) !== false || mb_strpos($nameLower, $tLower) !== false;
                    });
                }
                if ($cat) {
                    $blog->categories()->syncWithoutDetaching([$cat->id]);
                    $attachedCats[$cat->id] = $cat->name;
                }
            }

            // If none attached yet, try searching content text for category names
            if (empty($attachedCats)) {
                $contentTextLower = mb_strtolower(strip_tags($content));
                foreach ($allCategories as $c) {
                    $nameLower = mb_strtolower($c->name);
                    if ($nameLower === '') {
                        continue;
                    }
                    if (mb_strpos($contentTextLower, $nameLower) !== false) {
                        $blog->categories()->syncWithoutDetaching([$c->id]);
                        $attachedCats[$c->id] = $c->name;
                    }
                }
            }

            if (! empty($attachedCats)) {
                $this->command->info("Attached categories to {$slug}: ".implode(', ', $attachedCats));
            }

            $this->command->info("Imported blog: {$slug}");
        }
    }
}
