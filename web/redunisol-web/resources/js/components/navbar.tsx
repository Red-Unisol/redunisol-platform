import { Link } from '@inertiajs/react';
import {
    InfoIcon,
    ListIcon,
    MoneyIcon,
    QuestionIcon,
    UserCheckIcon,
    XIcon,
} from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';

export const defaultSectionLabel = (
    type: string,
    data?: Record<string, unknown>,
) => {
    if (data?.title) return data.title as string;
    const map: Record<string, string> = {
        form: 'Solicitá hoy',
        services: 'Créditos',
        about: 'Sobre nosotros',
        faqs: 'FAQs',
        hero: 'Inicio',
        testimonios: 'Testimonios',
        convenios: 'Convenios',
        requisitos: 'Requisitos',
    };
    return map[type] ?? 'Sección';
};

function SectionIcon({ type, size = 18 }: { type: string; size?: number }) {
    if (type === 'form') return <UserCheckIcon size={size} />;
    if (type === 'services') return <MoneyIcon size={size} />;
    if (type === 'about') return <InfoIcon size={size} />;
    if (type === 'faqs') return <QuestionIcon size={size} />;
    return null;
}

export default function NavTabs({
    sections = [],
    activeId,
    onNavigate,
}: {
    sections: { id: string; type: string; data?: Record<string, unknown> }[];
    activeId: string | null;
    onNavigate: (id: string) => void;
}) {
    const [open, setOpen] = useState(false);

    const handleNavigate = (id: string) => {
        onNavigate(id);
        setOpen(false);
    };

    return (
        <>
            {/* ── Barra principal ── */}
            <nav className="fixed z-30 flex w-full items-center justify-between bg-transparent px-6 py-4 text-xs md:absolute md:px-8">
                {/* Logo */}
                <Link href="/" className="rounded-2xl bg-[#1c273b] pt-0.5">
                    <img
                        src="/images/general/t1JdNn2n4csoI8qGYVfVNKs7w.png"
                        alt="UNISOL"
                        className="h-10 cursor-pointer"
                    />
                </Link>

                {/* Tabs — solo desktop */}
                <div className="hidden items-center gap-1 rounded-2xl bg-white p-1 md:flex">
                    {sections.map((s) => {
                        const label = defaultSectionLabel(s.type, s.data);
                        const isActive = activeId === s.id;
                        return (
                            <button
                                key={s.id}
                                onClick={() => handleNavigate(s.id)}
                                aria-current={isActive ? 'true' : undefined}
                                className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 font-semibold transition ${
                                    isActive
                                        ? 'bg-[#cbd5e1] text-[#1F2A37]'
                                        : 'bg-transparent text-[#1F2A37] opacity-70 hover:opacity-100'
                                }`}
                            >
                                <SectionIcon type={s.type} />
                                <span>{label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Hamburger — solo mobile */}
                <button
                    onClick={() => setOpen((v) => !v)}
                    aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
                    aria-expanded={open}
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#1F2A37] shadow-sm transition active:scale-95 md:hidden"
                >
                    {open ? <XIcon size={20} /> : <ListIcon size={20} />}
                </button>
            </nav>

            {/* ── Overlay — cierra el menú al tocar fuera ── */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        key="overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="fixed inset-0 z-20 bg-black/20 md:hidden"
                        onClick={() => setOpen(false)}
                    />
                )}
            </AnimatePresence>

            {/* ── Panel mobile ── */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        key="mobile-menu"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="fixed top-18 z-30 w-full px-4 md:hidden"
                    >
                        <div className="overflow-hidden rounded-2xl bg-white shadow-xl">
                            {sections.map((s, i) => {
                                const label = defaultSectionLabel(
                                    s.type,
                                    s.data,
                                );
                                const isActive = activeId === s.id;
                                return (
                                    <button
                                        key={s.id}
                                        onClick={() => handleNavigate(s.id)}
                                        className={`flex w-full items-center gap-3 px-5 py-4 text-left text-sm font-semibold transition ${
                                            i > 0
                                                ? 'border-t border-gray-100'
                                                : ''
                                        } ${
                                            isActive
                                                ? 'bg-[#cbd5e1] text-[#1F2A37]'
                                                : 'text-[#1F2A37] hover:bg-gray-50'
                                        }`}
                                    >
                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1e2d3d]/8 text-[#1e2d3d]">
                                            <SectionIcon
                                                type={s.type}
                                                size={16}
                                            />
                                        </span>
                                        {label}
                                        {isActive && (
                                            <span className="ml-auto h-2 w-2 rounded-full bg-[#6BAF92]" />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
