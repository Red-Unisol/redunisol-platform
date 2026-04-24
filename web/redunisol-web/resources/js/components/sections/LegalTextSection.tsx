import { motion } from 'framer-motion';
import { FileTextIcon } from '@phosphor-icons/react';

export interface LegalTextSectionData {
    title: string;
    content: string;
}

export default function LegalTextSection({ data }: { data: LegalTextSectionData }) {
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
                        <h1 className="text-lg font-bold text-gray-900">{data.title}</h1>
                    </div>

                    <div
                        className="prose prose-gray max-w-none text-gray-700 [&_a]:text-[#6BAF92] [&_a]:underline [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-gray-900 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:my-1 [&_p]:my-4 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-6"
                        dangerouslySetInnerHTML={{ __html: data.content }}
                    />
                </motion.div>
            </div>
        </section>
    );
}
