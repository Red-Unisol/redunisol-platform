import { Link } from '@inertiajs/react';
import { motion } from 'framer-motion';

export interface BlogCategory {
    id: number;
    name: string;
    slug: string;
}

export interface BlogPost {
    id: number;
    title: string;
    slug: string;
    excerpt: string | null;
    content: string;
    image_url: string | null;
    author_name: string;
    published_at: string;
    categories: BlogCategory[];
}

export interface PaginatedPosts {
    data: BlogPost[];
    current_page: number;
    last_page: number;
    next_page_url: string | null;
    prev_page_url: string | null;
}

function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('es-AR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

export default function BlogCard({
    post,
    index = 0,
}: {
    post: BlogPost;
    index?: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + index * 0.08, duration: 0.5 }}
            className="h-full"
        >
            <Link
                href={`/blog/${post.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[#97aeaf] bg-white transition hover:shadow-md"
            >
                {/* Image */}
                <div className="aspect-video w-full overflow-hidden">
                    {post.image_url ? (
                        <img
                            src={post.image_url}
                            alt={post.title}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                    ) : (
                        <div className="h-full w-full bg-linear-to-br from-[#1e2d3d] to-[#265c5e]" />
                    )}
                </div>

                {/* Body */}
                <div className="flex flex-1 flex-col gap-3 p-5">
                    {/* Categories */}
                    {post.categories.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {post.categories.map((cat) => (
                                <span
                                    key={cat.id}
                                    className="rounded-full bg-[#6BAF9220] px-3 py-0.5 text-xs font-medium text-[#6BAF92]"
                                >
                                    {cat.name}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Title */}
                    <h2 className="line-clamp-2 leading-snug font-semibold text-[#1e2d3d]">
                        {post.title}
                    </h2>

                    {/* Excerpt */}
                    {post.excerpt && (
                        <p className="line-clamp-3 flex-1 text-sm leading-relaxed text-gray-500">
                            {post.excerpt}
                        </p>
                    )}

                    {/* Date / Author */}
                    <div className="mt-auto flex items-center justify-between border-t border-[#97aeaf]/40 pt-3">
                        <span className="text-xs text-gray-400">
                            {formatDate(post.published_at)}
                        </span>
                        <span className="text-xs text-gray-400">
                            {post.author_name}
                        </span>
                    </div>

                    {/* Read more */}
                    <span className="inline-block text-sm font-medium text-[#6BAF92] transition-transform duration-200 group-hover:translate-x-1">
                        Leer más →
                    </span>
                </div>
            </Link>
        </motion.div>
    );
}
