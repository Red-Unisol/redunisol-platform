import { usePage } from '@inertiajs/react';
import { motion } from 'framer-motion';

import BlogCard, { type BlogPost } from '@/components/blog/BlogCard';
import Footer from '@/components/footer';
import Navbar from '@/components/navbar';

interface BlogShowProps {
    post: BlogPost;
    latestPosts: BlogPost[];
    [key: string]: unknown;
}

function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('es-AR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

export default function BlogShow() {
    const { post, latestPosts } = usePage<BlogShowProps>().props;

    return (
        <>
            <Navbar activeTab="unset" setActiveTab={() => {}} />

            {/* Hero */}
            <div className="bg-gradient-custom relative flex min-h-115 items-end overflow-hidden">
                {post.image_url && (
                    <img
                        src={post.image_url}
                        alt={post.title}
                        className="absolute inset-0 h-full w-full object-cover"
                    />
                )}

                {/* Overlay */}
                <div className="absolute inset-0 bg-linear-to-t from-[#1e2d3d]/90 via-[#1e2d3d]/50 to-transparent" />

                <div className="relative mx-auto w-full max-w-4xl px-6 pt-36 pb-14">
                    {/* Categories */}
                    {post.categories.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                            className="mb-4 flex flex-wrap gap-2"
                        >
                            {post.categories.map((cat) => (
                                <span
                                    key={cat.id}
                                    className="rounded-full bg-[#6BAF9230] px-3 py-0.5 text-xs font-medium text-[#6BAF92]"
                                >
                                    {cat.name}
                                </span>
                            ))}
                        </motion.div>
                    )}

                    {/* Title */}
                    <motion.h1
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1, duration: 0.6 }}
                        className="text-3xl leading-tight font-bold text-white md:text-5xl"
                    >
                        {post.title}
                    </motion.h1>

                    {/* Meta */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25, duration: 0.5 }}
                        className="mt-4 flex items-center gap-3 text-sm text-white/70"
                    >
                        <span>{formatDate(post.published_at)}</span>
                        <span className="text-white/40">·</span>
                        <span>{post.author_name}</span>
                    </motion.div>
                </div>
            </div>

            <div className="bg-white">
                {/* Article content */}
                <motion.article
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.6 }}
                    className={[
                        'mx-auto max-w-3xl px-6 py-12',
                        '[&_table]:my-6 [&_table]:w-full [&_table]:border-collapse',
                        '[&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold',
                        '[&_td]:border [&_td]:border-gray-200 [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm',
                        '[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-[#1e2d3d]',
                        '[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-[#1e2d3d]',
                        '[&_p]:mb-4 [&_p]:leading-relaxed [&_p]:text-gray-700',
                        '[&_ul]:mb-4 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6',
                        '[&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6',
                        '[&_li]:text-gray-700',
                        '[&_a]:text-[#6BAF92] [&_a]:underline [&_a]:hover:text-[#4a8a6e]',
                        '[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-[#6BAF92] [&_blockquote]:pl-4 [&_blockquote]:text-gray-500 [&_blockquote]:italic',
                        '[&_img]:my-6 [&_img]:w-full [&_img]:rounded-xl [&_img]:object-cover',
                        '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-[#1e2d3d] [&_pre]:p-4 [&_pre]:text-sm [&_pre]:text-gray-200',
                        '[&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm [&_code]:text-[#1e2d3d]',
                        '[&_hr]:my-8 [&_hr]:border-[#97aeaf]/40',
                    ].join(' ')}
                    dangerouslySetInnerHTML={{ __html: post.content }}
                />

                {/* Latest posts */}
                {latestPosts.length > 0 && (
                    <section className="border-t border-[#97aeaf]/30 bg-[#265c5e08]">
                        <div className="mx-auto max-w-6xl px-6 py-12">
                            <motion.h2
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.5 }}
                                className="mb-8 text-2xl font-bold text-[#1e2d3d]"
                            >
                                Últimas entradas
                            </motion.h2>

                            <div className="grid gap-4 md:grid-cols-2">
                                {latestPosts.slice(0, 4).map((p, i) => (
                                    <BlogCard key={p.id} post={p} index={i} />
                                ))}
                            </div>
                        </div>
                    </section>
                )}

                <Footer />
            </div>
        </>
    );
}
