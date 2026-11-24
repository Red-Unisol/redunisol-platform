import { Link, usePage } from '@inertiajs/react';
import {
    ArrowLeftIcon,
    ArrowRightIcon,
    CaretDownIcon,
    EnvelopeSimpleIcon,
    FileTextIcon,
    ShieldCheckIcon,
} from '@phosphor-icons/react';
import { useMemo } from 'react';

import Footer from '@/components/footer';
import Navbar from '@/components/navbar';
import SeoHead from '@/components/seo-head';
import { platformContact, platformName } from '@/data/home-platform-copy';
import type { PlatformLegalDocument } from '@/types/legal-document';

interface LegalDocumentProps {
    document: PlatformLegalDocument;
    [key: string]: unknown;
}

// Only add navigation attributes to the trusted, Git-managed document HTML.
// Wording and paragraphs remain intact.
function withSectionAnchors(content: string) {
    const headings: { id: string; title: string }[] = [];
    const html = content.replace(
        /<h2>([\s\S]*?)<\/h2>/g,
        (_, title: string) => {
            const id = `document-section-${headings.length + 1}`;
            headings.push({ id, title });
            return `<h2 id="${id}" tabindex="-1">${title}</h2>`;
        },
    );
    return { html, headings };
}

export default function LegalDocumentPage() {
    const { document } = usePage<LegalDocumentProps>().props;
    const { html, headings } = useMemo(
        () => withSectionAnchors(document.content),
        [document.content],
    );
    const isPrivacy = document.title === 'Política de Privacidad';
    const DocumentIcon = isPrivacy ? ShieldCheckIcon : FileTextIcon;
    const related = isPrivacy
        ? { href: '/terminos', title: 'Términos y Condiciones' }
        : { href: '/privacidad', title: 'Política de Privacidad' };

    const contents = (
        <nav aria-label="Índice del documento" className="space-y-1">
            {headings.map(({ id, title }) => (
                <a
                    key={id}
                    href={`#${id}`}
                    className="block rounded-lg px-3 py-2.5 text-[13px] leading-relaxed text-slate-600 transition-colors hover:bg-[#edf5f1] hover:text-[#356c57] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6BAF92]"
                    dangerouslySetInnerHTML={{ __html: title }}
                />
            ))}
        </nav>
    );

    return (
        <>
            <SeoHead
                title={document.title}
                description={document.description}
                robots="noindex, nofollow"
            />
            <div className="bg-[#1c273b]">
                <Navbar reserveMobileSpace />
                <header className="relative overflow-hidden bg-gradient-to-br from-[#1c273b] to-[#30493f] px-6 pt-9 pb-16 md:pt-32 md:pb-20">
                    <div className="relative mx-auto max-w-[1180px]">
                        <Link
                            href="/"
                            className="mb-10 inline-flex items-center gap-2 text-xs font-medium text-slate-300 transition hover:text-white"
                        >
                            <ArrowLeftIcon size={14} aria-hidden="true" />
                            Volver al inicio
                        </Link>
                        <div className="flex items-center gap-2.5 text-xs font-semibold tracking-[0.16em] text-[#a4d2bc] uppercase">
                            <DocumentIcon size={19} aria-hidden="true" />
                            Documentación legal
                        </div>
                        <h1
                            id="legal-document-title"
                            className="mt-5 max-w-3xl text-[34px] leading-[1.15] font-semibold tracking-tight text-balance text-white md:text-[52px]"
                        >
                            {document.title}
                        </h1>
                        <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-200 md:text-lg">
                            {document.description}
                        </p>
                        {document.draft && (
                            <p className="mt-6 inline-flex items-center gap-2.5 rounded-full border border-amber-200/20 bg-amber-100/10 px-3.5 py-1.5 text-xs text-amber-100">
                                <span
                                    className="size-1.5 rounded-full bg-amber-200"
                                    aria-hidden="true"
                                />
                                Borrador para revisión
                            </p>
                        )}
                    </div>
                </header>
            </div>

            <main className="bg-[#f5f7f6] px-4 pb-16 md:px-6 md:pb-24">
                <div className="relative mx-auto max-w-[1180px] -translate-y-6 lg:grid lg:grid-cols-[250px_minmax(0,1fr)] lg:items-start lg:gap-9">
                    <aside className="hidden lg:sticky lg:top-8 lg:block lg:pt-12">
                        <p className="mb-4 px-3 text-[11px] font-bold tracking-[0.16em] text-slate-400 uppercase">
                            En esta página
                        </p>
                        {contents}
                        <div className="mt-7 border-t border-slate-200 px-3 pt-6">
                            <p className="text-xs text-slate-500">
                                También podés consultar
                            </p>
                            <Link
                                href={related.href}
                                className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#356c57] hover:underline"
                            >
                                {related.title}
                                <ArrowRightIcon
                                    size={16}
                                    aria-hidden="true"
                                    className="shrink-0"
                                />
                            </Link>
                        </div>
                    </aside>

                    <article
                        aria-labelledby="legal-document-title"
                        className="min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_36px_-20px_rgba(28,39,59,0.2)] md:rounded-3xl"
                    >
                        <details className="group border-b border-slate-100 px-6 py-5 lg:hidden">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[#1c273b] [&::-webkit-details-marker]:hidden">
                                Contenido del documento
                                <CaretDownIcon
                                    size={17}
                                    aria-hidden="true"
                                    className="transition-transform group-open:rotate-180"
                                />
                            </summary>
                            <div className="mt-4">{contents}</div>
                        </details>
                        <div className="px-6 py-8 sm:px-10 sm:py-10 lg:px-12 lg:py-12">
                            <div
                                id="legal-document-content"
                                className="text-[15px] leading-[1.85] break-words text-slate-600 [&_a]:text-[#356c57] [&_a]:underline [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:scroll-mt-28 [&_h2]:border-t [&_h2]:border-slate-100 [&_h2]:pt-8 [&_h2]:text-lg [&_h2]:leading-snug [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-[#1c273b] lg:[&_h2]:scroll-mt-10 lg:[&_h2]:text-xl [&_h2:first-child]:mt-0 [&_h2:first-child]:border-0 [&_h2:first-child]:pt-0 [&_h2:focus]:outline-none [&_p]:my-4 [&_p:last-child]:mb-0"
                                dangerouslySetInnerHTML={{ __html: html }}
                            />
                            <div className="mt-10 border-t border-slate-200 pt-7">
                                <p className="text-xs font-semibold tracking-wide text-slate-500">
                                    {platformName}
                                </p>
                                <a
                                    href={`mailto:${platformContact}`}
                                    className="mt-3 inline-flex items-center gap-2 text-sm text-[#356c57] hover:underline"
                                >
                                    <EnvelopeSimpleIcon
                                        size={17}
                                        aria-hidden="true"
                                    />
                                    {platformContact}
                                </a>
                            </div>
                        </div>
                    </article>
                </div>
                <div className="mx-auto mt-3 max-w-[1180px] lg:hidden">
                    <Link
                        href={related.href}
                        className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-[#356c57]"
                    >
                        {related.title}
                        <ArrowRightIcon size={18} aria-hidden="true" />
                    </Link>
                </div>
            </main>
            <Footer showPlatformDisclosure />
        </>
    );
}
