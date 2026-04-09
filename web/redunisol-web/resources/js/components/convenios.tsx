import { Link } from '@inertiajs/react';
import { HandshakeIcon } from '@phosphor-icons/react/dist/ssr';
import { motion } from 'framer-motion';

export interface ConvenioItem {
    name: string;
    detail?: string;
    href?: string;
}

export interface ConveniosData {
    title: string;
    items: ConvenioItem[];
}

function ConvenioCard({ item, index }: { item: ConvenioItem; index: number }) {
    const card = (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + index * 0.08, duration: 0.5 }}
            className={[
                'flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#97aeaf]',
                'bg-[#265c5e0d] p-6 text-center transition hover:shadow-md',
                item.href ? 'hover:border-[#6BAF92] hover:bg-[#265c5e18]' : '',
            ].join(' ')}
        >
            <p className="font-bold text-[#1F2A37]">{item.name}</p>
            {item.detail && (
                <p className="text-xs text-gray-500">{item.detail}</p>
            )}
            {item.href && (
                <span className="mt-1 text-xs font-medium text-[#6BAF92]">
                    Ver más →
                </span>
            )}
        </motion.div>
    );

    if (item.href) {
        return (
            <Link href={item.href} className="block">
                {card}
            </Link>
        );
    }

    return card;
}

export default function Convenios({ data }: { data: ConveniosData }) {
    return (
        <section className="m-auto w-full max-w-200 text-gray-800">
            <div className="mx-auto max-w-5xl px-6 py-8 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="m-auto mb-8 flex w-fit items-center gap-4 rounded-xl border p-2"
                >
                    <HandshakeIcon size={24} />
                    <p className="text-normal font-bold">{data.title}</p>
                </motion.div>

                <div className="grid gap-6 md:grid-cols-2">
                    {data.items.map((item, i) => (
                        <ConvenioCard key={i} item={item} index={i} />
                    ))}
                </div>
            </div>
        </section>
    );
}
