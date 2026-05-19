import { router, usePage } from '@inertiajs/react';
import { motion } from 'framer-motion';

import BlogCard, { type PaginatedPosts } from '@/components/blog/BlogCard';
import Footer from '@/components/footer';
import Navbar from '@/components/navbar';

interface Author {
    id: number;
    name: string;
    slug: string;
    bio: string | null;
    role: string | null;
    photo_url: string | null;
}

interface AuthorProps {
    author: Author;
    posts: PaginatedPosts;
    [key: string]: unknown;
}

/** Devuelve las iniciales del nombre (máximo 2 caracteres). */
function getInitials(name: string): string {
    return name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('');
}

export default function AuthorPage() {
    const { author, posts } = usePage<AuthorProps>().props;

    return (
        <>
            <Navbar activeTab="unset" setActiveTab={() => {}} />

            <div className="bg-gradient-custom w-full">
                {/* ── Hero ── */}
                <section className="px-6 pt-32 pb-20 text-center">
                    {/* Avatar */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.5 }}
                        className="mx-auto mb-6 h-28 w-28 overflow-hidden rounded-full border-4 border-[#97aeaf]/50 shadow-lg"
                    >
                        {author.photo_url ? (
                            <img
                                src={author.photo_url}
                                alt={author.name}
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center bg-[#1e2d3d]">
                                <span className="text-3xl font-bold tracking-wide text-white">
                                    {getInitials(author.name)}
                                </span>
                            </div>
                        )}
                    </motion.div>

                    {/* Name */}
                    <motion.h1
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1, duration: 0.6 }}
                        className="text-4xl font-semibold tracking-tight text-[#1e2d3d] md:text-6xl"
                    >
                        {author.name}
                    </motion.h1>

                    {/* Role */}
                    {author.role && (
                        <motion.p
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2, duration: 0.5 }}
                            className="mt-3 text-base font-medium text-[#6BAF92] md:text-lg"
                        >
                            {author.role}
                        </motion.p>
                    )}

                    {/* Bio */}
                    {author.bio && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.3, duration: 0.5 }}
                            className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-gray-700 md:text-lg [&_a]:text-[#6BAF92] [&_a]:underline [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5"
                            dangerouslySetInnerHTML={{ __html: author.bio }}
                        />
                    )}
                </section>

                {/* ── Content ── */}
                <main className="rounded-tl-4xl rounded-tr-4xl bg-white">
                    <div className="mx-auto max-w-6xl px-6 py-12">
                        {/* Section title */}
                        <motion.h2
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                            className="mb-8 text-2xl font-bold text-[#1e2d3d]"
                        >
                            Artículos de{' '}
                            <span className="text-[#6BAF92]">
                                {author.name}
                            </span>
                        </motion.h2>

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
                                    Todavía no hay artículos publicados por este
                                    autor.
                                </p>
                            </motion.div>
                        ) : (
                            <>
                                {/* Grid */}
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
