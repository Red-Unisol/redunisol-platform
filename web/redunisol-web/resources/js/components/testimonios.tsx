import { ChatCircleTextIcon } from '@phosphor-icons/react/dist/ssr';
import { motion } from 'framer-motion';

export interface TestimonioItem {
    quote: string;
    name: string;
    role: string;
}

export interface TestimoniosData {
    title: string;
    items: TestimonioItem[];
}

function TestimonioCard({
    item,
    index,
}: {
    item: TestimonioItem;
    index: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + index * 0.08, duration: 0.5 }}
            className="flex flex-col gap-4 rounded-2xl border border-[#97aeaf] bg-[#265c5e0d] p-6 transition hover:shadow-md"
        >
            <span className="text-5xl font-serif leading-none text-[#6BAF92]">
                &ldquo;
            </span>
            <p className="flex-1 text-sm leading-relaxed text-gray-600">
                {item.quote}
            </p>
            <div className="border-t border-[#97aeaf] pt-4">
                <p className="font-bold text-[#1F2A37]">{item.name}</p>
                <p className="mt-0.5 text-xs text-gray-500">{item.role}</p>
            </div>
        </motion.div>
    );
}

export default function Testimonios({ data }: { data: TestimoniosData }) {
    return (
        <section className="m-auto w-full max-w-200 text-gray-800">
            <div className="mx-auto max-w-5xl px-6 py-8 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="m-auto mb-10 flex w-fit items-center gap-4 rounded-xl border p-2"
                >
                    <ChatCircleTextIcon size={24} />
                    <p className="text-normal font-bold">{data.title}</p>
                </motion.div>

                <div className="grid gap-6 md:grid-cols-2">
                    {data.items.map((item, i) => (
                        <TestimonioCard key={i} item={item} index={i} />
                    ))}
                </div>
            </div>
        </section>
    );
}
