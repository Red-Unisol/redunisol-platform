import { CheckCircleIcon, ClipboardTextIcon } from '@phosphor-icons/react/dist/ssr';
import { motion } from 'framer-motion';

export interface RequisitosData {
    title: string;
    items: { text: string }[];
}

export default function Requisitos({ data }: { data: RequisitosData }) {
    return (
        <section className="w-full text-gray-800">
            <div className="mx-auto max-w-3xl px-6 py-12 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="m-auto mb-8 flex w-fit items-center gap-4 rounded-xl border p-2"
                >
                    <ClipboardTextIcon size={24} />
                    <p className="text-normal font-bold">{data.title}</p>
                </motion.div>

                <ul className="space-y-4 text-left">
                    {data.items.map((item, i) => (
                        <motion.li
                            key={i}
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15 + i * 0.07, duration: 0.5 }}
                            className="flex items-start gap-3"
                        >
                            <CheckCircleIcon
                                size={22}
                                weight="fill"
                                className="mt-0.5 shrink-0 text-[#6BAF92]"
                            />
                            <span className="text-[15px] leading-relaxed text-[#1F2A37]">
                                {item.text}
                            </span>
                        </motion.li>
                    ))}
                </ul>
            </div>
        </section>
    );
}
