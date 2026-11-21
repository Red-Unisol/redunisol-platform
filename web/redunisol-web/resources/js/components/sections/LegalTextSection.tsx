import { FileTextIcon } from '@phosphor-icons/react';
import { motion } from 'framer-motion';

import SectionCtaButton, { type SectionCta } from '@/components/section-cta';

export interface LegalTextSectionData {
    title: string;
    content: string;
    cta?: SectionCta;
    pdfUrl?: string;
    draft?: boolean;
    description?: string;
}

export default function LegalTextSection({
    data,
    headingLevel = 'h2',
}: {
    data: LegalTextSectionData;
    headingLevel?: 'h1' | 'h2';
}) {
    const Heading = headingLevel;
    return (
        <section className="w-full bg-white py-16">
            <div className="mx-auto max-w-3xl px-6">
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="mb-8"
                >
                    <div className="mb-6 flex items-center gap-3 rounded-xl border border-gray-200 p-3">
                        <FileTextIcon size={22} />
                        <Heading className="text-lg font-bold text-gray-900">
                            {data.title}
                        </Heading>
                    </div>

                    {data.description && (
                        <p className="mb-6 text-gray-600">{data.description}</p>
                    )}
                    {data.draft && (
                        <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                            Borrador para revisión
                        </p>
                    )}
                    {data.pdfUrl && (
                        <div className="mb-8 flex flex-wrap gap-3">
                            <a
                                href={data.pdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-xl bg-[#1F2A37] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2d3f54]"
                            >
                                Abrir PDF en otra pestaña
                            </a>
                            <a
                                href={data.pdfUrl}
                                download
                                className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                            >
                                Descargar PDF
                            </a>
                        </div>
                    )}

                    <div
                        className="prose prose-gray max-w-none text-gray-700 [&_a]:text-[#6BAF92] [&_a]:underline [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-gray-900 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:my-1 [&_p]:my-4 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-6"
                        dangerouslySetInnerHTML={{ __html: data.content }}
                    />
                </motion.div>
                <SectionCtaButton cta={data.cta} />
            </div>
        </section>
    );
}
