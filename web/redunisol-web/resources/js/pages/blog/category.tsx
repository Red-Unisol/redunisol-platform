import { router, usePage } from '@inertiajs/react';
import { motion } from 'framer-motion';

import BlogCard, {
    type BlogCategory,
    type PaginatedPosts,
} from '@/components/blog/BlogCard';
import Footer from '@/components/footer';
import Navbar from '@/components/navbar';

interface BlogCategoryProps {
    category: BlogCategory;
    posts: PaginatedPosts;
    [key: string]: unknown;
}

export default function BlogCategoryPage() {
    const { category, posts } = usePage<BlogCategoryProps>().props;

    return (
        <>
            <Navbar activeTab="unset" setActiveTab={() => {}} />

            <div className="bg-gradient-custom w-full">
                {/* Hero */}
                <section className="px-6 pt-32 pb-20 text-center">
                    <motion.h1
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6 }}
                        className="text-4xl font-semibold tracking-tight text-[#1e2d3d] md:text-6xl"
                    >
                        Categoría:{' '}
                        <span className="text-[#6BAF92]">{category.name}</span>
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15, duration: 0.6 }}
                        className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-gray-700 md:text-lg"
                    >
                        Artículos sobre {category.name}
                    </motion.p>
                </section>

                {/* Content */}
                <main className="rounded-tl-4xl rounded-tr-4xl bg-white">
                    <div className="mx-auto max-w-6xl px-6 py-12">
                        {posts.data.length === 0 ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.6 }}
                                className="py-24 text-center text-gray-400"
                            >
                                <p className="text-2xl font-semibold">
                                    Próximamente
                                </p>
                                <p className="mt-2 text-sm">
                                    Todavía no hay artículos en esta categoría.
                                </p>
                            </motion.div>
                        ) : (
                            <>
                                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                                    {posts.data.map((post, i) => (
                                        <BlogCard
                                            key={post.id}
                                            post={post}
                                            index={i}
                                        />
                                    ))}
                                </div>

                                {/* Pagination */}
                                {(posts.prev_page_url ||
                                    posts.next_page_url) && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{
                                            delay: 0.3,
                                            duration: 0.5,
                                        }}
                                        className="mt-12 flex items-center justify-center gap-4"
                                    >
                                        <button
                                            onClick={() =>
                                                posts.prev_page_url &&
                                                router.visit(
                                                    posts.prev_page_url,
                                                )
                                            }
                                            disabled={!posts.prev_page_url}
                                            className="rounded-xl border border-[#97aeaf] px-5 py-2 text-sm font-medium text-[#1e2d3d] transition hover:bg-[#6BAF9215] disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            ← Anterior
                                        </button>

                                        <span className="text-sm text-gray-500">
                                            Página {posts.current_page} de{' '}
                                            {posts.last_page}
                                        </span>

                                        <button
                                            onClick={() =>
                                                posts.next_page_url &&
                                                router.visit(
                                                    posts.next_page_url,
                                                )
                                            }
                                            disabled={!posts.next_page_url}
                                            className="rounded-xl border border-[#97aeaf] px-5 py-2 text-sm font-medium text-[#1e2d3d] transition hover:bg-[#6BAF9215] disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            Siguiente →
                                        </button>
                                    </motion.div>
                                )}
                            </>
                        )}
                    </div>

                    <Footer />
                </main>
            </div>
        </>
    );
}
