import { Link, usePage } from '@inertiajs/react';
import {
    FacebookLogo,
    InstagramLogo,
    LinkedinLogo,
    MapPin as MapPinIcon,
    YoutubeLogo,
} from '@phosphor-icons/react';

import { getRegulatorDisplayName } from '@/lib/regulators';

import WhatsAppButton from './WhatsAppButton';

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

const SOCIAL_FALLBACKS = {
    facebook_url: 'https://www.facebook.com/redunisol',
    linkedin_url: 'https://www.linkedin.com/company/redunisol/',
    instagram_url: 'https://www.instagram.com/redunisol_prestamos/',
    youtube_url: 'https://www.youtube.com/@redunisol5007',
};

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
    const displayName = getRegulatorDisplayName(reg.short_name, reg.name);

    return (
        <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-5">
            <p className="mb-4 text-xs font-bold tracking-widest text-gray-600 uppercase">
                {displayName}
            </p>

            {reg.logo_path && (
                <img
                    src={`/storage/${reg.logo_path}`}
                    alt={displayName}
                    className="mb-4 h-8 w-auto object-contain"
                />
            )}

            <ul className="space-y-2 text-xs text-gray-600">
                {reg.cuit && (
                    <li className="flex items-start gap-2">
                        <span className="text-gray-400">•</span>
                        <span>
                            <span className="font-semibold">CUIT:</span>{' '}
                            {reg.cuit}
                        </span>
                    </li>
                )}
                {reg.inaes_mat && (
                    <li className="flex items-start gap-2">
                        <span className="text-gray-400">•</span>
                        <span>
                            <span className="font-semibold">INAES:</span> Mat.
                            N° {reg.inaes_mat}
                        </span>
                    </li>
                )}
                {reg.bcra_code && (
                    <li className="flex items-start gap-2">
                        <span className="text-gray-400">•</span>
                        <span>
                            <span className="font-semibold">BCRA:</span> Cód. N°{' '}
                            {reg.bcra_code}
                        </span>
                    </li>
                )}
            </ul>

            {reg.url && (
                <a
                    href={reg.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-emerald-600 transition-all hover:gap-3 hover:text-emerald-700"
                >
                    Data Fiscal
                    <span>→</span>
                </a>
            )}
        </div>
    );
}

export default function Footer({
    showWhatsAppButton = true,
}: {
    showWhatsAppButton?: boolean;
}) {
    const { siteData } = usePage<SharedProps>().props;
    const regulators =
        siteData?.regulators && siteData.regulators.length > 0
            ? siteData.regulators
            : FALLBACK_REGULATORS;
    const settings = siteData?.settings ?? {};

    const socialLinks = [
        {
            label: 'Facebook',
            href: settings['facebook_url'] || SOCIAL_FALLBACKS.facebook_url,
            icon: FacebookLogo,
        },
        {
            label: 'LinkedIn',
            href: settings['linkedin_url'] || SOCIAL_FALLBACKS.linkedin_url,
            icon: LinkedinLogo,
        },
        {
            label: 'Instagram',
            href: settings['instagram_url'] || SOCIAL_FALLBACKS.instagram_url,
            icon: InstagramLogo,
        },
        {
            label: 'YouTube',
            href: settings['youtube_url'] || SOCIAL_FALLBACKS.youtube_url,
            icon: YoutubeLogo,
        },
    ];

    // Build BCRA statement dynamically from regulator data
    const bcraRegulators = regulators.filter((reg) => reg.bcra_code?.trim());
    const bcraStatement =
        bcraRegulators
            .map(
                (reg) =>
                    `${getRegulatorDisplayName(reg.short_name, reg.name)} (Nº ${reg.bcra_code})`,
            )
            .join(' y ') +
        ' son Proveedores no Financieros de Crédito regulados por el BCRA.';

    return (
        <footer className="w-full">
            {/* ── BCRA Banner ── */}
            <div className="border-t-4 border-emerald-600 bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-4 text-center shadow-md">
                <p className="text-xs leading-relaxed text-gray-200">
                    {bcraStatement}
                </p>
            </div>

            {/* ── Main Footer Content ── */}
            <div className="bg-white px-6 py-16 lg:px-8">
                <div className="mx-auto max-w-7xl">
                    {/* Grid principal */}
                    <div className="grid gap-12 md:grid-cols-12 lg:gap-16">
                        {/* Col 1: Brand & Info (3 cols) */}
                        <div className="md:col-span-3">
                            <Link
                                href="/"
                                className="mb-4 block w-fit rounded-2xl bg-[#1c273b] pt-0.5"
                            >
                                <img
                                    src="/images/general/t1JdNn2n4csoI8qGYVfVNKs7w.png"
                                    alt="UNISOL"
                                    className="h-10 cursor-pointer"
                                />
                            </Link>
                            <p className="mb-6 text-sm leading-relaxed text-gray-600">
                                UNISOL y el logo de UNISOL son marcas
                                registradas. Todos los derechos reservados.
                            </p>

                            {/* Location */}
                            {settings['map_address'] && (
                                <div className="mb-6">
                                    {settings['map_url'] ? (
                                        <a
                                            href={settings['map_url']}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-3 text-sm font-medium text-gray-700 transition-colors hover:text-emerald-600"
                                        >
                                            <MapPinIcon
                                                size={18}
                                                className="flex-shrink-0"
                                            />
                                            <span>
                                                {settings['map_address']}
                                            </span>
                                        </a>
                                    ) : (
                                        <div className="inline-flex items-center gap-3 text-sm text-gray-700">
                                            <MapPinIcon
                                                size={18}
                                                className="flex-shrink-0"
                                            />
                                            <span>
                                                {settings['map_address']}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Social Links */}
                            <div className="flex items-center gap-4">
                                {socialLinks.map(
                                    ({ label, href, icon: Icon }) => (
                                        <a
                                            key={label}
                                            href={href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            aria-label={label}
                                            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-all hover:bg-emerald-600 hover:text-white"
                                        >
                                            <Icon size={18} weight="bold" />
                                        </a>
                                    ),
                                )}
                            </div>
                        </div>

                        {/* Spacer for alignment */}
                        <div className="hidden md:col-span-1 md:block" />

                        {/* Col 2: Navigation (3 cols) */}
                        <div className="md:col-span-2">
                            <h3 className="mb-5 text-xs font-bold tracking-widest text-gray-900 uppercase">
                                Acerca de
                            </h3>
                            <ul className="space-y-3">
                                {navLinks.map((link) => (
                                    <li key={link.href}>
                                        <Link
                                            href={link.href}
                                            className="text-sm text-gray-600 transition-colors hover:font-medium hover:text-emerald-600"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Col 3: Support (3 cols) */}
                        <div className="md:col-span-2">
                            <h3 className="mb-5 text-xs font-bold tracking-widest text-gray-900 uppercase">
                                Soporte
                            </h3>
                            <ul className="space-y-3">
                                {legalLinks.map((link) => (
                                    <li key={link.href}>
                                        <Link
                                            href={link.href}
                                            className="text-sm text-gray-600 transition-colors hover:font-medium hover:text-emerald-600"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* Regulators Section */}
                    <div className="mt-16 border-t border-gray-200 pt-16">
                        <h3 className="mb-8 text-sm font-bold tracking-widest text-gray-900 uppercase">
                            Reguladores Autorizados
                        </h3>
                        <div className="grid gap-6 sm:grid-cols-2">
                            {regulators.map((reg) => (
                                <RegulatorCard key={reg.id} reg={reg} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Footer Bottom ── */}
            <div className="border-t border-gray-200 bg-gray-50 px-6 py-8 text-center lg:px-8">
                <p className="mb-3 text-xs text-gray-500">
                    © {new Date().getFullYear()} UNISOL. Todos los derechos
                    reservados.
                </p>
                <p className="text-xs text-gray-400">
                    Powered by{' '}
                    <a
                        href="https://solva.ar"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-emerald-600 transition-colors hover:text-emerald-700"
                    >
                        Solva
                    </a>
                </p>
            </div>

            {showWhatsAppButton && <WhatsAppButton />}
        </footer>
    );
}
