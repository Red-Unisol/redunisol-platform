import { useState } from 'react';

import data from '@/data/pages/home.json';

import About from '@/components/about';
import Hero from '@/components/hero';
import Navbar, { tabs } from '@/components/navbar';
import Services from '@/components/services';

export default function Page() {
    const { hero, services, about } = data;
    const [activeTab, setActiveTab] = useState(tabs[0].key);

    return (
        <>
<<<<<<< HEAD
            <Head title="Welcome">
                <link rel="preconnect" href="https://fonts.bunny.net" />
                <link
                    href="https://fonts.bunny.net/css?family=instrument-sans:400,500,600"
                    rel="stylesheet"
                />
            </Head>
            <div className="flex min-h-screen flex-col items-center bg-[#FDFDFC] p-6 text-[#1b1b18] lg:justify-center lg:p-8 dark:bg-[#0a0a0a]">
                <header className="mb-6 w-full max-w-[335px] text-sm not-has-[nav]:hidden lg:max-w-4xl">
                </header>
                <div className="flex w-full items-center justify-center opacity-100 transition-opacity duration-750 lg:grow starting:opacity-0">
                    <main className="flex w-full max-w-[335px] flex-col-reverse lg:max-w-4xl lg:flex-row">
                        <div className="flex-1 rounded-br-lg rounded-bl-lg bg-white p-6 pb-12 text-[13px] leading-[20px] shadow-[inset_0px_0px_0px_1px_rgba(26,26,0,0.16)] lg:rounded-tl-lg lg:rounded-br-none lg:p-20 dark:bg-[#161615] dark:text-[#EDEDEC] dark:shadow-[inset_0px_0px_0px_1px_#fffaed2d]">
                            <h1 className="mb-1 font-medium">
                                Red Unisol
                            </h1>
                            <p className="mb-2 text-[#706f6c] dark:text-[#A1A09A]">
                                Estamos actualizando esta sección con el contenido renderizado.
                            </p>
                        </div>
                    </main>
                </div>
                <div className="hidden h-14.5 lg:block"></div>
=======
            <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />
            <div className="w-full">
                {activeTab === 'solicita' && <Hero data={hero} />}
                {activeTab === 'creditos' && <Services data={services} />}
                {activeTab === 'about' && <About data={about} />}
                {activeTab === 'faqs' && <div>Contenido de FAQs</div>}
>>>>>>> 818b193399ff42e849711e9392de102cdfe5832d
            </div>
        </>
    );
}
