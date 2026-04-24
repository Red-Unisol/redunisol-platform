import { Link, usePage } from '@inertiajs/react';
import {
    FacebookLogo,
    InstagramLogo,
    LinkedinLogo,
    YoutubeLogo,
} from '@phosphor-icons/react';

interface Regulator {
    id: number;
    name: string;
    short_name: string | null;
    logo_path: string | null;
    inaes_mat: string | null;
    bcra_code: string | null;
    cuit: string | null;
    url: string | null;
    is_active: boolean;
    sort_order: number;
}

interface SharedProps {
    siteData?: {
        regulators?: Regulator[];
        settings?: Record<string, string>;
    };
    [key: string]: unknown;
}

const legalLinks = [
    { label: 'Sobre Nosotros', href: '/sobre-nosotros' },
    { label: 'Contacto', href: '/contacto' },
    { label: 'Políticas de Privacidad', href: '/politicas-de-privacidad' },
    { label: 'Gestión de Datos', href: '/gestion-de-datos' },
];

const navLinks = [
    { label: 'Inicio', href: '/' },
    { label: 'Conocénos', href: '/sobre-nosotros' },
    { label: 'Blog', href: '/blog' },
];

const socialLinks = [
    {
        label: 'Facebook',
        href: 'https://www.facebook.com/redunisol',
        icon: FacebookLogo,
    },
    {
        label: 'LinkedIn',
        href: 'https://www.linkedin.com/company/redunisol/',
        icon: LinkedinLogo,
    },
    {
        label: 'Instagram',
        href: 'https://www.instagram.com/redunisol_prestamos/',
        icon: InstagramLogo,
    },
    {
        label: 'YouTube',
        href: 'https://www.youtube.com/@redunisol5007',
        icon: YoutubeLogo,
    },
];

// Fallback regulator data if DB is not yet seeded
const FALLBACK_REGULATORS: Regulator[] = [
    {
        id: 1,
        name: 'Asociación Mutual Celesol de Servicios Integrales y Educativos',
        short_name: 'Celesol',
        logo_path: null,
        inaes_mat: '768',
        bcra_code: '55281',
        cuit: '33-70870702-9',
        url: null,
        is_active: true,
        sort_order: 1,
    },
    {
        id: 2,
        name: 'Asociación Mutual Fiat Concord',
        short_name: 'Fiat Concord',
        logo_path: null,
        inaes_mat: '233',
        bcra_code: '55277',
        cuit: '30-62415628-1',
        url: null,
        is_active: true,
        sort_order: 2,
    },
];

function RegulatorCard({ reg }: { reg: Regulator }) {
    return (
        <div>
            <p className="mb-4 text-xs font-bold tracking-widest text-gray-400 uppercase">
                {reg.short_name ?? reg.name}
            </p>

            {reg.logo_path && (
                <img
                    src={`/storage/${reg.logo_path}`}
                    alt={reg.short_name ?? reg.name}
                    className="mb-3 h-10 w-auto object-contain grayscale"
                />
            )}

            <ul className="space-y-1 text-xs text-gray-500">
                {reg.cuit && <li>CUIT {reg.cuit}</li>}
                {reg.inaes_mat && (
                    <li>Regulada por el INAES, Mat. N° {reg.inaes_mat}</li>
                )}
                {reg.bcra_code && (
                    <li>
                        Proveedor No Financiero BCRA, Cód. N° {reg.bcra_code}
                    </li>
                )}
            </ul>

            {reg.url && (
                <a
                    href={reg.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#6BAF92] transition-opacity hover:opacity-70"
                >
                    Data Fiscal →
                </a>
            )}
        </div>
    );
}

export default function Footer() {
    const { siteData } = usePage<SharedProps>().props;
    const regulators =
        siteData?.regulators && siteData.regulators.length > 0
            ? siteData.regulators
            : FALLBACK_REGULATORS;
    const settings = siteData?.settings ?? {};
    const disclaimer = settings['legal_disclaimer'] ?? '';

    // Build BCRA statement dynamically from regulator data
    const bcraStatement =
        regulators
            .map((r) => `${r.short_name ?? r.name} (Nº ${r.bcra_code})`)
            .join(' y ') +
        ' son Proveedores no Financieros de Crédito regulados por el BCRA.';

    return (
        <footer className="w-full">
            {/* ── Legal Links + Disclaimer ── */}
            <div className="border-t border-gray-200 bg-gray-50 px-8 py-10">
                <div className="mx-auto max-w-5xl">
                    {/* Links row */}
                    <div className="mb-6 flex flex-wrap items-center justify-center gap-3 border-b border-gray-200 pb-6">
                        {legalLinks.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 hover:underline"
                            >
                                {link.label}
                            </Link>
                        ))}
                        <span className="hidden text-gray-300 sm:inline">
                            |
                        </span>
                        <Link
                            href="/"
                            className="rounded-lg bg-[#1F2A37] px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#2d3f54]"
                        >
                            Solicita tu crédito
                        </Link>
                    </div>

                    {/* Disclaimer text */}
                    {disclaimer && (
                        <p className="text-center text-[11px] leading-relaxed text-gray-400">
                            {disclaimer}
                        </p>
                    )}
                </div>
            </div>

            {/* ── BCRA Banner ── */}
            <div className="bg-[#1F2A37] px-8 py-3 text-center">
                <p className="text-xs text-gray-300">{bcraStatement}</p>
            </div>

            {/* ── Main Footer ── */}
            <div className="bg-white px-8 py-12">
                <div className="mx-auto max-w-5xl">
                    <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
                        {/* Col 1: Brand */}
                        <div>
                            <img
                                src="/images/general/t1JdNn2n4csoI8qGYVfVNKs7w.png"
                                alt="UNISOL"
                                className="mb-4 h-10 w-auto"
                            />
                            <p className="text-xs leading-relaxed text-gray-500">
                                UNISOL y el logo de UNISOL son marcas
                                registradas. Todos los derechos reservados.
                            </p>

                            {/* Social */}
                            <div className="mt-5 flex items-center gap-3">
                                {socialLinks.map(
                                    ({ label, href, icon: Icon }) => (
                                        <a
                                            key={label}
                                            href={href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            aria-label={label}
                                            className="text-gray-500 transition-opacity hover:opacity-60"
                                        >
                                            <Icon size={16} weight="bold" />
                                        </a>
                                    ),
                                )}
                            </div>
                        </div>

                        {/* Col 2: Navigation + Legal */}
                        <div>
                            <p className="mb-4 text-xs font-bold tracking-widest text-gray-400 uppercase">
                                Acerca de
                            </p>
                            <ul className="space-y-2">
                                {navLinks.map((link) => (
                                    <li key={link.href}>
                                        <Link
                                            href={link.href}
                                            className="text-sm text-gray-600 transition-colors hover:text-gray-900 hover:underline"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>

                            <p className="mt-6 mb-4 text-xs font-bold tracking-widest text-gray-400 uppercase">
                                Soporte
                            </p>
                            <ul className="space-y-2">
                                {legalLinks.map((link) => (
                                    <li key={link.href}>
                                        <Link
                                            href={link.href}
                                            className="text-sm text-gray-600 transition-colors hover:text-gray-900 hover:underline"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Regulator columns */}
                        {regulators.map((reg) => (
                            <RegulatorCard key={reg.id} reg={reg} />
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Copyright Strip ── */}
            {/*<div className="border-t border-gray-100 bg-white px-8 py-4">
                <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-gray-400">
                        © {new Date().getFullYear()} Red Unisol — Todos los
                        Derechos Reservados.
                    </p>
                    <p className="text-xs text-gray-400">
                        Desarrollado &amp; Diseñado por{' '}
                        <a
                            href="https://buuum.com.ar"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="transition-colors hover:text-gray-700 hover:underline"
                        >
                            Buuum! Agencia Digital Freelance
                        </a>
                    </p>
                </div>
            </div>*/}
        </footer>
    );
}
