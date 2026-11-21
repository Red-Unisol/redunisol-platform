import { usePage } from '@inertiajs/react';

import Footer from '@/components/footer';
import Navbar from '@/components/navbar';
import LegalTextSection, {
    type LegalTextSectionData,
} from '@/components/sections/LegalTextSection';
import SeoHead from '@/components/seo-head';

interface LegalDocumentProps {
    document: LegalTextSectionData & { description: string };
    [key: string]: unknown;
}

export default function LegalDocumentPage() {
    const { document } = usePage<LegalDocumentProps>().props;

    return (
        <>
            <SeoHead
                title={document.title}
                description={document.description}
                robots="noindex, nofollow"
            />
            <Navbar reserveMobileSpace />
            <main className="bg-gradient-custom px-2 py-8 md:px-6 md:pt-28">
                <div className="mx-auto max-w-[1350px] overflow-hidden rounded-2xl bg-white">
                    <LegalTextSection data={document} headingLevel="h1" />
                </div>
            </main>
            <Footer showPlatformDisclosure />
        </>
    );
}
