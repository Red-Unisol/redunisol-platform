/* eslint-disable import/order */
import { usePage } from '@inertiajs/react';
import { useEffect, useMemo, useRef, useState } from 'react';

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
import useActiveSection from '@/hooks/useActiveSection';
import useTracking from '@/hooks/useTracking';
import { faqSchema, organizationSchema, serviceSchema } from '@/utils/schemas';
import { MouseScrollIcon } from '@phosphor-icons/react';

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

// Helper to find a section by type
function useSection<T>(sections: PageSection[], type: string): T | undefined {
    return sections?.find((s) => s.type === type)?.data as T | undefined;
}

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

    // ── Form section is special: used to decide split layout ──
    const formSection = sections.find((s) => s.type === 'form');
    const formConfig = formSection?.data as FormSectionConfig | undefined;

    const formSectionData = useSection<FormSectionConfig>(sections, 'form');

    const sectionDescriptors = sections.map((s, idx) => ({
        id: `section-${idx}-${s.type}`,
        type: s.type,
        data: s.data,
    }));

    const hasForm = !!formSectionData;
    const leftSections = hasForm
        ? sectionDescriptors.filter((s) => s.type !== 'form')
        : sectionDescriptors;

    const leftRef = useRef<HTMLDivElement | null>(null);

    const { activeId, scrollToSection } = useActiveSection(leftRef);

    // When we have the split layout (form present on desktop), implement "scroll
    // chaining": scrolls within the left column while the pointer is over it.
    // Once the left column reaches its end, allow the document/page to continue
    // scrolling (revealing the footer). This avoids hiding the document scrollbar
    // completely and keeps the footer reachable.
    useEffect(() => {
        const el = leftRef.current;
        if (typeof window === 'undefined' || !el) return;

        const mql = window.matchMedia('(min-width: 768px)');
        if (!mql.matches) return; // only on desktop

        let touchStartY = 0;

        const onWheel = (e: WheelEvent) => {
            if (!hasForm) return;
            const delta = e.deltaY;
            const scrollTop = el.scrollTop;
            const maxScroll = el.scrollHeight - el.clientHeight;

            if (delta > 0) {
                // scrolling down
                if (scrollTop >= maxScroll - 1) {
                    // at bottom: allow page scroll (do not prevent)
                    return;
                }
                e.preventDefault();
                el.scrollBy({ top: delta, left: 0, behavior: 'auto' });
            } else if (delta < 0) {
                // scrolling up
                if (scrollTop <= 1) {
                    // at top: allow page scroll
                    return;
                }
                e.preventDefault();
                el.scrollBy({ top: delta, left: 0, behavior: 'auto' });
            }
        };

        const onTouchStart = (e: TouchEvent) => {
            touchStartY = e.touches[0]?.clientY ?? 0;
        };

        const onTouchMove = (e: TouchEvent) => {
            if (!hasForm) return;
            const currentY = e.touches[0]?.clientY ?? 0;
            let delta = touchStartY - currentY; // positive -> scroll down
            // small threshold to avoid jitter
            if (Math.abs(delta) < 2) return;

            const scrollTop = el.scrollTop;
            const maxScroll = el.scrollHeight - el.clientHeight;

            if (delta > 0) {
                // swipe up -> scroll down
                if (scrollTop >= maxScroll - 1) {
                    // at bottom: allow page scroll
                    return;
                }
                e.preventDefault();
                el.scrollBy({ top: delta, left: 0, behavior: 'auto' });
            } else if (delta < 0) {
                // swipe down -> scroll up
                if (scrollTop <= 1) {
                    // at top: allow page scroll
                    return;
                }
                e.preventDefault();
                el.scrollBy({ top: delta, left: 0, behavior: 'auto' });
            }

            touchStartY = currentY;
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });

        return () => {
            el.removeEventListener('wheel', onWheel as EventListener);
            el.removeEventListener('touchstart', onTouchStart as EventListener);
            el.removeEventListener('touchmove', onTouchMove as EventListener);
        };
    }, [hasForm, leftRef]);

    // All non-form sections rendered in order (for JSON-LD etc.)
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

            <Navbar
                sections={sectionDescriptors}
                activeId={activeId}
                onNavigate={(id: string) => {
                    scrollToSection(id);
                }}
            />

            <div className="bg-gradient-custom w-full">
                <div
                    className={`mx-auto max-w-[1350px] px-2 md:px-6 ${hasForm ? 'md:grid md:max-h-[calc(100vh-4rem)] md:grid-cols-[1fr_420px] md:gap-8' : 'pt-18'}`}
                >
                    <div
                        ref={leftRef}
                        className={`${hasForm ? 'rounded-2xl bg-white md:my-27 md:max-h-[calc(100vh-11rem)] md:overflow-y-auto' : 'rounded-2xl bg-white'}`}
                    >
                        {leftSections.map((s) => {
                            const id = s.id;
                            const key = `${id}`;

                            const sectionClass = 'py-12';

                            // Tab-based visibility (for landing pages)
                            const hiddenTab = TAB_HIDDEN_MAP[s.type];
                            if (hiddenTab && activeTab === hiddenTab)
                                return null;

                            switch (s.type) {
                                case 'hero':
                                    return (
                                        <section
                                            id={id}
                                            data-section-id={id}
                                            key={key}
                                            className={sectionClass}
                                        >
                                            <Hero data={s.data as any} />
                                        </section>
                                    );
                                case 'services':
                                    return (
                                        <section
                                            id={id}
                                            data-section-id={id}
                                            key={key}
                                            className={sectionClass}
                                        >
                                            <Services data={s.data as any} />
                                        </section>
                                    );
                                case 'about':
                                    return (
                                        <section
                                            id={id}
                                            data-section-id={id}
                                            key={key}
                                            className={sectionClass}
                                        >
                                            <About data={s.data as any} />
                                        </section>
                                    );
                                case 'faqs':
                                    return (
                                        <section
                                            id={id}
                                            data-section-id={id}
                                            key={key}
                                            className={sectionClass}
                                        >
                                            <FAQs data={s.data as any} />
                                        </section>
                                    );
                                case 'convenios':
                                    return (
                                        <section
                                            id={id}
                                            data-section-id={id}
                                            key={key}
                                            className={sectionClass}
                                        >
                                            <Convenios data={s.data as any} />
                                        </section>
                                    );
                                case 'requisitos':
                                    return (
                                        <section
                                            id={id}
                                            data-section-id={id}
                                            key={key}
                                            className={sectionClass}
                                        >
                                            <Requisitos data={s.data as any} />
                                        </section>
                                    );
                                case 'testimonios':
                                    return (
                                        <section
                                            id={id}
                                            data-section-id={id}
                                            key={key}
                                            className={sectionClass}
                                        >
                                            <Testimonios data={s.data as any} />
                                        </section>
                                    );
                                case 'form':
                                    return (
                                        <section
                                            id={id}
                                            data-section-id={id}
                                            key={key}
                                            className={`${sectionClass} md:hidden`}
                                        >
                                            <FormSection
                                                config={s.data as any}
                                                landingSlug={landingSlug}
                                                landingTitle={title}
                                            />
                                        </section>
                                    );
                                default: {
                                    // Fallback: render via SECTION_COMPONENTS if available
                                    const Component =
                                        SECTION_COMPONENTS[s.type];
                                    if (Component) {
                                        return (
                                            <section
                                                id={id}
                                                data-section-id={id}
                                                key={key}
                                                className={sectionClass}
                                            >
                                                <Component data={s.data} />
                                            </section>
                                        );
                                    }

                                    return (
                                        <section
                                            id={id}
                                            data-section-id={id}
                                            key={key}
                                            className={sectionClass}
                                        >
                                            <div className="p-6 text-gray-600">
                                                Sección: {s.type}
                                            </div>
                                        </section>
                                    );
                                }
                            }
                        })}
                    </div>

                    {hasForm && (
                        <aside className="hidden md:block">
                            <div className="absolute top-24">
                                <FormSection
                                    config={formSectionData}
                                    landingSlug={landingSlug}
                                    landingTitle={title}
                                />
                            </div>
                        </aside>
                    )}
                </div>
                <div className="mt-8 flex items-center justify-center gap-3 pb-8">
                    <MouseScrollIcon size={24} className="text-[#8a9bb5]" />
                    <span className="text-normal font-bold text-[#8a9bb5]">
                        Scroll para seguir viendo
                    </span>
                </div>

                <Footer />
            </div>
        </>
    );
}
