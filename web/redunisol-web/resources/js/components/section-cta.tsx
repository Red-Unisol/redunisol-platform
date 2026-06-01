import { motion } from 'framer-motion';

export interface SectionCta {
    enabled?: boolean;
    text?: string;
    link?: string;
}

export default function SectionCtaButton({ cta }: { cta?: SectionCta }) {
    if (!cta?.enabled || !cta.text || !cta.link) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mt-8 flex justify-center"
        >
            <a
                href={cta.link}
                className="rounded-xl bg-[#1F2A37] px-6 py-3 font-medium text-white transition hover:bg-[#2d3f54] active:scale-95"
            >
                {cta.text}
            </a>
        </motion.div>
    );
}
