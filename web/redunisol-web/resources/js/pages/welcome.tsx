import useTracking from '@/hooks/useTracking';
import { usePage } from '@inertiajs/react';
import { useMemo, useState } from 'react';

import About from '@/components/about';
import Convenios from '@/components/convenios';
import FAQs from '@/components/faqs';
import Footer from '@/components/footer';
import Hero from '@/components/hero';
import Navbar from '@/components/navbar';
import Requisitos from '@/components/requisitos';
import ContactSection from '@/components/sections/ContactSection';
import FormSection, {
    type FormSectionConfig,
} from '@/components/sections/FormSection';
import LegalTextSection from '@/components/sections/LegalTextSection';
import RegulatorySection from '@/components/sections/RegulatorySection';
import YouTubeSection from '@/components/sections/YouTubeSection';
import SeoHead from '@/components/seo-head';
import Services from '@/components/services';
import Testimonios from '@/components/testimonios';
import { faqSchema, organizationSchema, serviceSchema } from '@/utils/schemas';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface PageSection {
    type: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any>;
}

interface HomePageProps {
    landingSlug: string;
    sections: PageSection[];
    title: string;
    meta_title?: string;
    meta_description?: string;
    keyword?: string;
    index?: boolean;
    [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
// Section component map
// Sections are rendered in the order they appear in the DB.
// ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SECTION_COMPONENTS: Record<string, React.ComponentType<{ data: any }>> = {
    hero: Hero,
    services: Services,
    about: About,
    faqs: FAQs,
    convenios: Convenios,
    requisitos: Requisitos,
    testimonios: Testimonios,
    youtube: YouTubeSection,
    legal_text: LegalTextSection,
    contact: ContactSection,
    regulatory: RegulatorySection,
};

/**
 * Maps a section type to the activeTab key that hides it.
 * e.g. hero is hidden when activeTab === 'solicita'
 */
const TAB_HIDDEN_MAP: Record<string, string> = {
    hero: 'solicita',
    services: 'creditos',
    about: 'about',
};

// ─────────────────────────────────────────────────────────────
// Page component
// ─────────────────────────────────────────────────────────────

export default function Page() {
    const {
        landingSlug,
        sections = [],
        title,
        meta_title,
        meta_description,
        keyword,
        index,
    } = usePage<HomePageProps>().props;

    const [activeTab, setActiveTab] = useState('unset');

    useTracking();

    // ── Form section is special: rendered outside <main> ──
    const formSection = sections.find((s) => s.type === 'form');
    const formConfig = formSection?.data as FormSectionConfig | undefined;

    // All non-form sections rendered in order
    const mainSections = sections.filter((s) => s.type !== 'form');

    // ── JSON-LD schemas ──
    const schemas = useMemo(() => {
        const result: object[] = [organizationSchema()];

        const servicesData = sections.find((s) => s.type === 'services')?.data;
        const faqsData = sections.find((s) => s.type === 'faqs')?.data;

        if (servicesData) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            result.push(serviceSchema(servicesData as any));
        }
        if (faqsData) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            result.push(faqSchema(faqsData as any));
        }

        return result;
    }, [sections]);

    // ── SEO ──
    const seoTitle = meta_title || title;
    const seoDescription =
        meta_description || `${title} - Soluciones de crédito personalizadas`;
    const robots = index === false ? 'noindex, nofollow' : 'index, follow';

    return (
        <>
            <SeoHead
                title={seoTitle}
                description={seoDescription}
                keyword={keyword}
                robots={robots}
                canonical={
                    typeof window !== 'undefined'
                        ? window.location.href
                        : undefined
                }
                ogTitle={seoTitle}
                ogDescription={seoDescription}
                schemas={schemas}
            />

            <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

            <div className="bg-gradient-custom w-full">
                {/* Form section sits above the white card when present */}
                {formConfig && (
                    <FormSection
                        config={formConfig}
                        landingSlug={landingSlug}
                        landingTitle={title}
                    />
                )}

                <main className="rounded-tl-4xl rounded-tr-4xl bg-white">
                    {mainSections.map((section, i) => {
                        const Component = SECTION_COMPONENTS[section.type];
                        if (!Component) return null;

                        // Tab-based visibility (for landing pages)
                        const hiddenTab = TAB_HIDDEN_MAP[section.type];
                        if (hiddenTab && activeTab === hiddenTab) return null;

                        return <Component key={i} data={section.data} />;
                    })}
                </main>

                <Footer />
            </div>
        </>
    );
}
