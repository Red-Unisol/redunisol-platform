<?php

use App\Support\BlogExcerpt;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        foreach (DB::table('blogs')->select(['id', 'excerpt', 'content'])->orderBy('id')->cursor() as $blog) {
            if (! BlogExcerpt::containsCss($blog->excerpt ?? '')) {
                continue;
            }

            DB::table('blogs')->where('id', $blog->id)
                ->where('excerpt', $blog->excerpt)
                ->where('content', $blog->content)
                ->update(['excerpt' => BlogExcerpt::fromHtml($blog->content)]);
        }
    }

    public function down(): void
    {
        // Preserve corrected editorial summaries; never restore the leaked CSS.
    }
};
