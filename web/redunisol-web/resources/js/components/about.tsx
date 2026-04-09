import { InfoIcon } from '@phosphor-icons/react/dist/ssr';
import { motion } from 'framer-motion';

export interface AboutSection {
    title: string;
    description: string;
    extra: string;
}

export default function About({ data }: { data: AboutSection }) {
    return (
        <section className="w-full text-gray-800">
            <div className="mx-auto max-w-4xl px-6 py-20 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="m-auto mb-4 flex w-fit items-center gap-4 rounded-xl border p-2"
                >
                    <InfoIcon size={24} />
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
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.6 }}
                    className="mt-10 text-lg font-medium"
                >
                    {data.extra}
                </motion.div>

                <motion.button
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.45, duration: 0.6 }}
                    className="mt-6 rounded-xl bg-[#1F2A37] px-6 py-3 text-white"
                >
                    Más sobre Unisol
                </motion.button>
            </div>
        </section>
    );
}
