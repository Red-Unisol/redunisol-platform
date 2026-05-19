import {
    InfoIcon,
    MoneyIcon,
    QuestionIcon,
    UserCheckIcon,
} from '@phosphor-icons/react';

export const defaultSectionLabel = (type: string, data?: any) => {
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

import { Link } from '@inertiajs/react';

export default function NavTabs({
    sections = [],
    activeId,
    onNavigate,
}: {
    sections: { id: string; type: string; data?: any }[];
    activeId: string | null;
    onNavigate: (id: string) => void;
}) {
    return (
        <nav className="absolute z-30 flex w-full items-center justify-between bg-transparent px-8 py-4 text-xs">
            <div className="flex items-center gap-2">
                <Link href="/">
                    <img
                        src="/images/general/t1JdNn2n4csoI8qGYVfVNKs7w.png"
                        alt="UNISOL"
                        className="h-10 cursor-pointer"
                    />
                </Link>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-white">
                {sections.map((s) => {
                    const label = defaultSectionLabel(s.type, s.data);
                    const isActive = activeId === s.id;
                    return (
                        <button
                            key={s.id}
                            onClick={() => onNavigate(s.id)}
                            aria-current={isActive ? 'true' : undefined}
                            className={`text-normal flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 font-semibold transition ${
                                isActive
                                    ? 'bg-[#cbd5e1] text-[#1F2A37]'
                                    : 'bg-transparent text-[#1F2A37] opacity-70 hover:opacity-100'
                            } ${s.type === 'form' ? 'md:hidden' : ''}`}
                        >
                            {s.type === 'form' && <UserCheckIcon size={18} />}
                            {s.type === 'services' && <MoneyIcon size={18} />}
                            {s.type === 'about' && <InfoIcon size={18} />}
                            {s.type === 'faqs' && <QuestionIcon size={18} />}
                            <span
                                className={`${isActive ? 'inline' : 'hidden md:inline'}`}
                            >
                                {label}
                            </span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
