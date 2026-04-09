import { CaretDownIcon, QuestionIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';

interface FAQItem {
    q: string;
    a: string;
}

interface FAQCategory {
    title: string;
    items: FAQItem[];
}

export interface FAQsData {
    badge: string;
    description: string;
    cta: string;
    categories: FAQCategory[];
}

function RichText({ text }: { text: string }) {
    const parts = text.split('**');
    return (
        <>
            {parts.map((part, i) =>
                i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
            )}
        </>
    );
}

function AnimatedChevron({ open }: { open: boolean }) {
    return (
        <motion.div
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' as const }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500"
        >
            <CaretDownIcon size={16} />
        </motion.div>
    );
}

function AccordionItem({ q, a }: FAQItem) {
    const [open, setOpen] = useState(false);

    return (
        <div className="border-b border-gray-100">
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                className="flex w-full items-center gap-3 py-4 text-left"
            >
                <span className="mt-0.5 shrink-0 text-sm font-medium text-gray-400">
                    Q.
                </span>
                <span
                    className={`flex-1 text-[15px] leading-snug text-[#1e2d3d] transition-all ${
                        open ? 'font-bold' : 'font-medium'
                    }`}
                >
                    {q}
                </span>
                <AnimatedChevron open={open} />
            </button>

            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        key="answer"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                            duration: 0.25,
                            ease: 'easeInOut' as const,
                        }}
                        className="overflow-hidden"
                    >
                        <p className="pb-5 pl-6 text-sm leading-relaxed text-gray-600">
                            {a}
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export default function FAQs({ data }: { data: FAQsData }) {
    return (
        <section className="w-full bg-white py-20 text-gray-800">
            <div className="mx-auto max-w-3xl px-6">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="m-auto mb-4 flex w-fit items-center gap-4 rounded-xl border p-2"
                >
                    <QuestionIcon size={24} />
                    <p className="text-normal font-bold">{data.badge}</p>
                </motion.div>

                <p className="mb-14 text-center text-base leading-relaxed text-gray-700">
                    <RichText text={data.description} />
                </p>

                <div className="space-y-10">
                    {data.categories.map((cat) => (
                        <div key={cat.title}>
                            <h3 className="mb-1 text-xl font-bold text-[#1e2d3d]">
                                {cat.title}
                            </h3>
                            <div>
                                {cat.items.map((item, i) => (
                                    <AccordionItem
                                        key={i}
                                        q={item.q}
                                        a={item.a}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-14 flex justify-center">
                    <button
                        type="button"
                        className="rounded-2xl bg-[#1e2d3d] px-10 py-4 text-base font-bold text-white transition hover:bg-[#2d3f54] active:scale-95"
                    >
                        {data.cta}
                    </button>
                </div>
            </div>
        </section>
    );
}
