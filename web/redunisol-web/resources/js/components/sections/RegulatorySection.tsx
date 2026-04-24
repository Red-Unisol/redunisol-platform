import { usePage } from '@inertiajs/react';
import { motion } from 'framer-motion';
import { ShieldCheckIcon } from '@phosphor-icons/react';

export interface RegulatoryData {
    title?: string;
}

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

export default function RegulatorySection({ data }: { data: RegulatoryData }) {
    const { siteData } = usePage<SharedProps>().props;
    const regulators = siteData?.regulators ?? [];

    if (regulators.length === 0) return null;

    return (
        <section className="w-full bg-gray-50 py-16">
            <div className="mx-auto max-w-4xl px-6">
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="mb-10 flex items-center justify-center gap-3"
                >
                    <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2">
                        <ShieldCheckIcon size={20} className="text-[#6BAF92]" />
                        <p className="font-bold text-gray-800">{data.title ?? 'Respaldados por'}</p>
                    </div>
                </motion.div>

                <div className="grid gap-6 sm:grid-cols-2">
                    {regulators.map((reg, i) => (
                        <motion.div
                            key={reg.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.05 * i, duration: 0.4 }}
                            className="rounded-2xl border border-gray-200 bg-white p-6"
                        >
                            {reg.logo_path && (
                                <img
                                    src={`/storage/${reg.logo_path}`}
                                    alt={reg.short_name ?? reg.name}
                                    className="mb-4 h-12 w-auto object-contain"
                                />
                            )}
                            <p className="font-bold text-gray-900">
                                {reg.short_name ?? reg.name}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">{reg.name}</p>

                            <div className="mt-4 space-y-1 text-sm text-gray-600">
                                {reg.cuit && (
                                    <p>
                                        <span className="font-medium">CUIT:</span> {reg.cuit}
                                    </p>
                                )}
                                {reg.inaes_mat && (
                                    <p>
                                        <span className="font-medium">Regulada por el INAES,</span> Mat. N° {reg.inaes_mat}
                                    </p>
                                )}
                                {reg.bcra_code && (
                                    <p>
                                        <span className="font-medium">Proveedor No Financiero regulado por BCRA,</span> Cód. N° {reg.bcra_code}
                                    </p>
                                )}
                            </div>

                            {reg.url && (
                                <a
                                    href={reg.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-4 inline-block text-xs font-medium text-[#6BAF92] hover:underline"
                                >
                                    Ver información oficial →
                                </a>
                            )}
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
