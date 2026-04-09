import { usePage } from '@inertiajs/react';
import { useState } from 'react';

import About, { type AboutSection } from '@/components/about';
import Convenios, { type ConveniosData } from '@/components/convenios';
import FAQs, { type FAQsData } from '@/components/faqs';
import Footer from '@/components/footer';
import Hero, { type Hero as HeroData } from '@/components/hero';
import Navbar from '@/components/navbar';
import Requisitos, { type RequisitosData } from '@/components/requisitos';
import FormSection from '@/components/sections/FormSection';
import Services, { type ServicesData } from '@/components/services';
import Testimonios, { type TestimoniosData } from '@/components/testimonios';

interface PageSection {
    type: string;
    data: Record<string, unknown>;
}

interface HomePageProps {
    sections: PageSection[];
    title: string;
    [key: string]: unknown;
}

function useSection<T>(sections: PageSection[], type: string): T | undefined {
    return sections?.find((s) => s.type === type)?.data as T | undefined;
}

export default function Page() {
    const { sections } = usePage<HomePageProps>().props;
    const [activeTab, setActiveTab] = useState('unset');

    const hero = useSection<HeroData>(sections, 'hero');
    const services = useSection<ServicesData>(sections, 'services');
    const about = useSection<AboutSection>(sections, 'about');
    const faqs = useSection<FAQsData>(sections, 'faqs');
    const convenios = useSection<ConveniosData>(sections, 'convenios');
    const requisitos = useSection<RequisitosData>(sections, 'requisitos');
    const testimonios = useSection<TestimoniosData>(sections, 'testimonios');

    return (
        <>
            <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />
            <div className="bg-gradient-custom w-full">
                <FormSection />
                <main className="rounded-tl-4xl rounded-tr-4xl bg-white">
                    {activeTab !== 'solicita' && hero && <Hero data={hero} />}
                    {activeTab !== 'creditos' && services && (
                        <Services data={services} />
                    )}
                    {activeTab !== 'about' && about && <About data={about} />}
                    {faqs && <FAQs data={faqs} />}
                    {convenios && <Convenios data={convenios} />}
                    {requisitos && <Requisitos data={requisitos} />}
                    {testimonios && <Testimonios data={testimonios} />}
                </main>
                <Footer />
            </div>
        </>
    );
}
