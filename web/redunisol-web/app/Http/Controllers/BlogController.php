<?php

namespace App\Http\Controllers;

use App\Models\Author;
use App\Models\Blog;
use App\Models\Category;
use Inertia\Inertia;
use Inertia\Response;

class BlogController extends Controller
{
    public function index(): Response
    {
        $posts = Blog::with(['categories', 'authorProfile'])
            ->published()
            ->orderBy('published_at', 'desc')
            ->paginate(12)
            ->through(fn ($post) => $this->serializePost($post));

        return Inertia::render('blog/index', [
            'posts' => $posts,
        ]);
    }

    public function show(string $slug): Response
    {
        $post = Blog::with(['categories', 'authorProfile'])
            ->published()
            ->where('slug', $slug)
            ->firstOrFail();

        $latestPosts = Blog::with(['categories', 'authorProfile'])
            ->published()
            ->where('id', '!=', $post->id)
            ->orderBy('published_at', 'desc')
            ->limit(4)
            ->get()
            ->map(fn ($p) => $this->serializePost($p));

        return Inertia::render('blog/show', [
            'post'        => $this->serializePost($post),
            'latestPosts' => $latestPosts,
        ]);
    }

    public function category(string $slug): Response
    {
        $category = Category::where('slug', $slug)->firstOrFail();

        $posts = Blog::with(['categories', 'authorProfile'])
            ->published()
            ->whereHas('categories', fn ($q) => $q->where('slug', $slug))
            ->orderBy('published_at', 'desc')
            ->paginate(12)
            ->through(fn ($post) => $this->serializePost($post));

        return Inertia::render('blog/category', [
            'category' => $category->only('id', 'name', 'slug'),
            'posts'    => $posts,
        ]);
    }

    public function author(string $slug): Response
    {
        $author = Author::active()->where('slug', $slug)->firstOrFail();

        $posts = Blog::with(['categories', 'authorProfile'])
            ->published()
            ->where('author_entity_id', $author->id)
            ->orderBy('published_at', 'desc')
            ->paginate(12)
            ->through(fn ($post) => $this->serializePost($post));

        return Inertia::render('blog/author', [
            'author' => [
                'id'        => $author->id,
                'name'      => $author->name,
                'slug'      => $author->slug,
                'bio'       => $author->bio,
                'role'      => $author->role,
                'photo_url' => $author->photo_url,
            ],
            'posts' => $posts,
        ]);
    }

    private function serializePost(Blog $post): array
    {
        return [
            'id'           => $post->id,
            'title'        => $post->title,
            'slug'         => $post->slug,
            'excerpt'      => $post->excerpt,
            'content'      => $post->content,
            'image_url'    => $post->image_url,
            'author_name'  => $post->author_name,
            'author_slug'  => $post->author_slug,
            'published_at' => $post->published_at?->toIso8601String(),
            'categories'   => $post->categories->map(fn ($c) => [
                'id'   => $c->id,
                'name' => $c->name,
                'slug' => $c->slug,
            ])->all(),
        ];
    }
}
