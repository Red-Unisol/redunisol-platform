import { Link } from '@inertiajs/react';
import * as Icons from '@phosphor-icons/react';
import { MoneyIcon } from '@phosphor-icons/react/dist/ssr';
import { motion } from 'framer-motion';

export interface ServiceItem {
    text: string;
    icon: string;
    href?: string;
}

export interface ServicesData {
    title: string;
    description: string;
    items: ServiceItem[];
    note: string;
}

export const iconMap = {
    eyeglasses: Icons.EyeglassesIcon,
    buildings: Icons.BuildingApartmentIcon,
    'police-car': Icons.PoliceCarIcon,
    'chalkboard-teacher': Icons.ChalkboardTeacherIcon,
    'book-open-text': Icons.BookOpenTextIcon,
    'hand-heart': Icons.HandHeartIcon,
};

function ServiceCard({ item, index }: { item: ServiceItem; index: number }) {
    const Icon = iconMap[item.icon as keyof typeof iconMap];

    const card = (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + index * 0.08, duration: 0.5 }}
            className={[
                'flex flex-col items-center justify-center gap-4 rounded-2xl border border-[#97aeaf]',
                'bg-[#265c5e0d] p-6 text-center transition hover:shadow-md',
                item.href ? 'hover:border-[#6BAF92] hover:bg-[#265c5e18]' : '',
            ].join(' ')}
        >
            <div className="w-fit">
                {Icon && <Icon className="mb-2 h-6 w-6" />}
            </div>
            <p className="font-bold">{item.text}</p>
            {item.href && (
                <span className="text-xs font-medium text-[#6BAF92]">
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

export default function Services({ data }: { data: ServicesData }) {
    return (
        <section className="m-auto w-full max-w-200 text-gray-800">
            <div className="mx-auto max-w-5xl px-6 py-8 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="m-auto mb-4 flex w-fit items-center gap-4 rounded-xl border p-2"
                >
                    <MoneyIcon size={24} />
                    <p className="text-normal font-bold">{data.title}</p>
                </motion.div>

                <motion.p
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15, duration: 0.6 }}
                    className="mb-10"
                >
                    {data.description}
                </motion.p>

                <div className="grid gap-6 md:grid-cols-2">
                    {data.items.map((item, i) => (
                        <ServiceCard key={i} item={item} index={i} />
                    ))}
                </div>

                <motion.p
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4, duration: 0.6 }}
                    className="my-12"
                >
                    {data.note}
                </motion.p>
            </div>
        </section>
    );
}
