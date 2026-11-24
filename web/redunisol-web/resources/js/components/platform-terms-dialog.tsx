import { useRef } from 'react';

import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import type { PlatformLegalDocument } from '@/types/legal-document';

export default function PlatformTermsDialog({
    document,
}: {
    document: PlatformLegalDocument;
}) {
    const titleRef = useRef<HTMLHeadingElement>(null);

    return (
        <Dialog>
            <DialogTrigger asChild>
                <button
                    type="button"
                    className="cursor-pointer text-left text-sm font-semibold text-emerald-600 underline underline-offset-2 transition-colors hover:text-emerald-700"
                >
                    Términos y condiciones de la plataforma
                </button>
            </DialogTrigger>
            <DialogContent
                closeLabel="Cerrar términos de la plataforma"
                className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border-0 bg-white p-0 text-slate-700 sm:max-h-[85dvh] sm:w-full sm:max-w-3xl"
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    titleRef.current?.focus();
                }}
            >
                <DialogHeader className="shrink-0 border-b border-slate-200 bg-[#f2f7f4] px-5 py-5 pr-14 text-left sm:px-8 sm:pr-16">
                    <p className="text-[11px] font-semibold tracking-[0.14em] text-[#356c57] uppercase">
                        Red Unisol · Documentación legal
                    </p>
                    <DialogTitle
                        ref={titleRef}
                        tabIndex={-1}
                        className="text-xl leading-snug text-[#1c273b] outline-none sm:text-2xl"
                    >
                        Términos y condiciones de la plataforma
                    </DialogTitle>
                    <DialogDescription className="text-sm leading-relaxed text-slate-600">
                        {document.description}
                    </DialogDescription>
                    {document.draft && (
                        <p className="mt-1 w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-900">
                            Borrador para revisión
                        </p>
                    )}
                </DialogHeader>
                <div
                    role="region"
                    aria-label="Texto completo de los términos de la plataforma"
                    tabIndex={0}
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 outline-offset-[-4px] sm:px-8"
                >
                    <div
                        className="text-[15px] leading-[1.85] break-words text-slate-600 [&_a]:text-[#356c57] [&_a]:underline [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:leading-snug [&_h2]:font-semibold [&_h2]:text-[#1c273b] [&_h2:first-child]:mt-0 [&_p]:my-4"
                        dangerouslySetInnerHTML={{ __html: document.content }}
                    />
                </div>
                <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-8 sm:pb-4">
                    <DialogClose asChild>
                        <button
                            type="button"
                            className="cursor-pointer rounded-xl bg-[#1c273b] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#30493f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6BAF92]"
                        >
                            Cerrar
                        </button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
