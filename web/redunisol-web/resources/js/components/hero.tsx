// resources/js/Components/Hero.jsx

import { motion } from 'framer-motion';

export default function Hero() {
    return (
        <section className="w-full bg-[#F7F7F7]">
            <div className="mx-auto max-w-5xl px-6 pt-24 pb-20 text-center">
                {/* TITLE */}
                <motion.h1
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="text-[42px] leading-[1.1] font-semibold tracking-tight text-[#111] md:text-[64px]"
                >
                    Pedí tu préstamo
                    <br />
                    <span className="font-semibold text-[#6BAF92]">
                        de hasta $1.000.000
                    </span>
                </motion.h1>

                {/* DESCRIPTION */}
                <motion.p
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15, duration: 0.6 }}
                    className="mx-auto mt-6 max-w-2xl text-[16px] leading-relaxed text-[#6B7280] md:text-[18px]"
                >
                    Trabajamos con convenios activos de Bancos, Mutuales y otros
                    proveedores no financieros de créditos regulados por el
                    BCRA, buscando siempre el mejor crédito de nómina para vos.
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
                        <span className="font-semibold">50.000+</span> créditos
                        otorgados en más de una década
                    </p>
                </motion.div>
            </div>
        </section>
    );
}
