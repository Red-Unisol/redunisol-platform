import { useState } from 'react';

import FormSection from '@/components/sections/FormSection';

import data from '@/data/pages/home.json';

import About from '@/components/about';
import FAQs from '@/components/faqs';
import Hero from '@/components/hero';
import Navbar from '@/components/navbar';
import Services from '@/components/services';

export default function Page() {
    const { hero, services, about, faqs } = data;
    const [activeTab, setActiveTab] = useState('unset'); //tabs[0].key);

    return (
        <>
            <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />
            <div className="bg-gradient-custom w-full">
                <FormSection />
                <main className="bg-white">
                    {activeTab !== 'solicita' && <Hero data={hero} />}
                    {activeTab !== 'creditos' && <Services data={services} />}
                    {activeTab !== 'about' && <About data={about} />}
                    <FAQs data={faqs} />
                </main>
            </div>
        </>
    );
}
