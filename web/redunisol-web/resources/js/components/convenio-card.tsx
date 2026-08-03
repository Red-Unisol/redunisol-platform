import { Buildings } from '@phosphor-icons/react';

export interface ConvenioRegulator {
    short_name: string | null;
    name: string;
    cuit: string | null;
    inaes_mat: string | null;
    logo_url: string | null;
}

interface ConvenioCardProps {
    regulator: ConvenioRegulator;
}

const regulatorDetails = [
    ['CUIT', 'cuit'],
    ['Matrícula INAES', 'inaes_mat'],
] as const;

export default function ConvenioCard({ regulator }: ConvenioCardProps) {
    return (
        <section className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-5 shadow-sm sm:px-6 sm:py-6">
            <p className="text-sm font-medium text-emerald-950">
                Este crédito se brindó por el convenio de
            </p>

            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="flex h-24 w-full shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-white px-4 py-3 sm:h-28 sm:w-36">
                    {regulator.logo_url ? (
                        <img
                            src={regulator.logo_url}
                            alt={`Logo de ${regulator.name}`}
                            className="max-h-20 max-w-full object-contain"
                        />
                    ) : (
                        <Buildings
                            aria-hidden="true"
                            size={42}
                            weight="duotone"
                            className="text-emerald-400"
                        />
                    )}
                </div>

                <div className="min-w-0 flex-1">
                    <h2 className="text-lg leading-tight font-bold text-gray-900">
                        {regulator.name}
                    </h2>

                    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                        {regulatorDetails.map(([label, key]) => (
                            <div key={key}>
                                <dt className="text-xs font-medium text-gray-500">
                                    {label}
                                </dt>
                                <dd className="font-semibold text-gray-800">
                                    {regulator[key] || '-'}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </div>

            <p className="mt-5 text-sm leading-6 text-gray-700">
                El crédito será descontado por la{' '}
                <strong className="font-semibold text-gray-900">
                    {regulator.name}
                </strong>
                .
            </p>
            <p className="mt-3 text-xs leading-5 text-gray-500">
                RED UNISOL es el proveedor de infraestructura tecnológica
                utilizada para estos procesos.
            </p>
        </section>
    );
}
