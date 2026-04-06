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
            <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />
            <div className="w-full">
                {activeTab === 'solicita' && <Hero data={hero} />}
                {activeTab === 'creditos' && <Services data={services} />}
                {activeTab === 'about' && <About data={about} />}
                {activeTab === 'faqs' && <div>Contenido de FAQs</div>}
            </div>
        </>
    );
}
