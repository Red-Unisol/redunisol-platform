'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';

export interface Mutual {
    image: string;
    title: string;
}

interface MutualesGridProps {
    mutuales: Mutual[];
    initialVisible?: number;
    sectionTitle?: string;
}

export default function MutualesGrid({
    mutuales,
    initialVisible = 8,
    sectionTitle = 'MUTUALES',
}: MutualesGridProps) {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const visible = mutuales.slice(0, initialVisible);

    return (
        <div className="w-full">
            <motion.p
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="mb-8 text-center text-sm font-bold tracking-widest text-gray-700 uppercase"
            >
                {sectionTitle}
            </motion.p>

            <div className="relative flex flex-wrap items-center justify-center gap-8 px-4">
                {visible.map((mutual, index) => (
                    <motion.div
                        key={index}
                        className="relative flex cursor-default items-center justify-center"
                        onMouseEnter={() => setHoveredIndex(index)}
                        onMouseLeave={() => setHoveredIndex(null)}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.05 * index, duration: 0.4 }}
                    >
                        {/* Thumbnail logo */}
                        <motion.img
                            src={mutual.image}
                            alt={mutual.title}
                            className="h-14 w-auto max-w-20 object-contain grayscale transition-all duration-300"
                            animate={{
                                opacity: hoveredIndex === index ? 0.5 : 1,
                                scale: hoveredIndex === index ? 0.95 : 1,
                            }}
                            transition={{ duration: 0.2 }}
                        />

                        {/* Hover card – floats above the thumbnail */}
                        <AnimatePresence>
                            {hoveredIndex === index && (
                                <motion.div
                                    key="hover-card"
                                    className="pointer-events-none absolute bottom-[calc(100%+12px)] left-1/2 z-50 w-52 overflow-hidden rounded-2xl shadow-2xl"
                                    style={{ x: '-50%' }}
                                    initial={{ opacity: 0, y: 12, scale: 0.92 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 8, scale: 0.94 }}
                                    transition={{
                                        type: 'spring',
                                        stiffness: 340,
                                        damping: 28,
                                        mass: 0.8,
                                    }}
                                >
                                    {/* Image */}
                                    <div className="relative h-52 w-full bg-white">
                                        <img
                                            src={mutual.image}
                                            alt={mutual.title}
                                            className="h-full w-full object-contain p-4"
                                        />

                                        {/* Gradient overlay */}
                                        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-linear-to-t from-black/80 to-transparent" />

                                        {/* Title */}
                                        <motion.p
                                            className="absolute right-3 bottom-3 left-3 text-left text-sm leading-tight font-bold text-white drop-shadow"
                                            initial={{ opacity: 0, y: 6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{
                                                delay: 0.08,
                                                duration: 0.25,
                                            }}
                                        >
                                            {mutual.title}
                                        </motion.p>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}
