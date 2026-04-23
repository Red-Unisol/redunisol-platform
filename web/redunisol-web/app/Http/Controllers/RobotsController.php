<?php

namespace App\Http\Controllers;

use Illuminate\Http\Response;

class RobotsController extends Controller
{
    public function show(): Response
    {
        $robots = "User-agent: *\n";
        $robots .= "Allow: /\n";
        $robots .= "Disallow: /admin/\n";
        $robots .= "Disallow: /api/\n";
        $robots .= "Disallow: /storage/\n";
        $robots .= "Disallow: /finalizar.php\n";
        $robots .= "Disallow: /*.php$\n";
        $robots .= "\n";
        $robots .= "User-agent: *\n";
        $robots .= "Crawl-delay: 1\n";
        $robots .= "\n";
        $robots .= "Sitemap: " . url('/sitemap.xml') . "\n";

        return response($robots, 200, [
            'Content-Type' => 'text/plain; charset=UTF-8',
        ]);
    }
}
