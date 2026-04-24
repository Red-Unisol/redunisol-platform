import { motion } from 'framer-motion';
import { PlayCircleIcon } from '@phosphor-icons/react';

export interface YouTubeSectionData {
    url: string;
    title?: string;
    description?: string;
}

function extractYouTubeId(url: string): string | null {
    try {
        const u = new URL(url);
        if (u.hostname.includes('youtu.be')) {
            return u.pathname.slice(1);
        }
        if (u.searchParams.has('v')) {
            return u.searchParams.get('v');
        }
        const embedMatch = u.pathname.match(/\/embed\/([^/?]+)/);
        if (embedMatch) return embedMatch[1];
    } catch {
        // ignore
    }
    return null;
}

export default function YouTubeSection({ data }: { data: YouTubeSectionData }) {
    const videoId = extractYouTubeId(data.url);

    if (!videoId) return null;

    return (
        <section className="w-full bg-white py-16">
            <div className="mx-auto max-w-4xl px-6">
                {(data.title || data.description) && (
                    <motion.div
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                        className="mb-8 text-center"
                    >
                        {data.title && (
                            <div className="m-auto mb-4 flex w-fit items-center gap-3 rounded-xl border border-gray-200 p-2">
                                <PlayCircleIcon size={22} />
                                <p className="font-bold">{data.title}</p>
                            </div>
                        )}
                        {data.description && (
                            <p className="text-gray-600">{data.description}</p>
                        )}
                    </motion.div>
                )}

                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.5 }}
                    className="overflow-hidden rounded-2xl shadow-lg"
                >
                    <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                        <iframe
                            className="absolute inset-0 h-full w-full"
                            src={`https://www.youtube.com/embed/${videoId}`}
                            title={data.title ?? 'Video Red Unisol'}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                    </div>
                </motion.div>
            </div>
        </section>
    );
}
