<?php

use App\Models\Blog;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    $this->withoutVite();
    config()->set('inertia.ssr.enabled', false);
});

it('serves clean legacy cards while keeping the article body unchanged', function () {
    $content = '<style>.montserrat * { font-family: Montserrat; }</style><p>Si sos jubilado provincial.</p>';
    $post = Blog::create([
        'title' => 'Artículo', 'slug' => 'articulo', 'content' => $content,
        'author_id' => User::factory()->create()->id, 'published_at' => now()->subDay(),
    ]);
    // Simulate data imported before the fix, bypassing the model's new save hook.
    DB::table('blogs')->where('id', $post->id)->update([
        'excerpt' => '.montserrat * { font-family: Montserrat; } Si sos jubilado...',
    ]);

    $this->get('/blog')->assertOk()->assertInertia(fn (Assert $page) => $page
        ->component('blog/index')->where('posts.data.0.excerpt', 'Si sos jubilado provincial.'));
    $this->get('/blog/articulo')->assertOk()->assertInertia(fn (Assert $page) => $page
        ->component('blog/show')->where('post.content', $content));
    expect($post->fresh()->content)->toBe($content);
});

it('repairs persisted CSS excerpts idempotently without touching other fields or manual summaries', function () {
    $post = Blog::create([
        'title' => 'Artículo', 'slug' => 'reparar',
        'content' => '<style>p { color: red; }</style><p>Contenido editorial.</p>',
        'excerpt' => 'Resumen manual correcto.', 'author_id' => User::factory()->create()->id,
    ]);
    $migration = require database_path('migrations/2026_09_28_150000_repair_blog_excerpts_with_css.php');
    $original = (array) DB::table('blogs')->where('id', $post->id)->first();
    $migration->up();
    expect((array) DB::table('blogs')->where('id', $post->id)->first())->toBe($original);

    DB::table('blogs')->where('id', $post->id)->update(['excerpt' => 'p { color: red; } Contenido...']);
    $migration->up();
    $migration->up();
    expect((array) DB::table('blogs')->where('id', $post->id)->first())
        ->toBe(array_replace($original, ['excerpt' => 'Contenido editorial.']));
});

it('cleans new saved summaries without changing article content', function () {
    $content = '<style>p { color: red; }</style><p>Nuevo artículo.</p>';
    $post = Blog::create([
        'title' => 'Nuevo', 'slug' => 'nuevo', 'content' => $content,
        'excerpt' => 'p { color: red; } Nuevo...', 'author_id' => User::factory()->create()->id,
    ]);
    expect($post->fresh()->getRawOriginal('excerpt'))->toBe('Nuevo artículo.')
        ->and($post->fresh()->content)->toBe($content);
});
