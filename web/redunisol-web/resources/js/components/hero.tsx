import { motion } from 'framer-motion';

export interface Hero {
    title: string;
    highlight: string;
    description: string;
    socialProof: {
        prefix: string;
        suffix: string;
    };
}
export default function Hero({ data }: { data: Hero }) {
    return (
        <section className="m-auto w-full max-w-200">
            <div className="mx-auto max-w-5xl px-6 pt-24 pb-20 text-center">
                {/* TITLE */}
                <motion.h1
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="text-[42px] leading-[1.1] font-semibold tracking-tight text-[#111] md:text-[64px]"
                >
                    {data.title}
                    <br />
                    <span className="font-semibold text-[#6BAF92]">
                        {data.highlight}
                    </span>
                </motion.h1>

                {/* DESCRIPTION */}
                <motion.p
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15, duration: 0.6 }}
                    className="mx-auto mt-6 max-w-2xl text-[16px] leading-relaxed text-gray-800 md:text-[18px]"
                >
                    {data.description}
                </motion.p>

                {/* SOCIAL PROOF */}
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.6 }}
                    className="mt-8 flex items-center justify-center gap-4"
                >
                    {/* AVATARS */}
                    <div className="flex -space-x-3">
                        <img
                            src="/images/user1.jpg"
                            className="h-9 w-9 rounded-full border-2 border-white"
                        />
                        <img
                            src="/images/user2.jpg"
                            className="h-9 w-9 rounded-full border-2 border-white"
                        />
                        <img
                            src="/images/user3.jpg"
                            className="h-9 w-9 rounded-full border-2 border-white"
                        />
                    </div>

                    {/* TEXT */}
                    <p className="text-sm font-medium text-[#374151]">
                        <span className="font-semibold">
                            {data.socialProof.prefix} {data.socialProof.suffix}
                        </span>
                    </p>
                </motion.div>
            </div>
        </section>
    );
}
