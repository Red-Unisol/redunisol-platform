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
        <section
            aria-labelledby="convenio-title"
            className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm sm:p-6"
        >
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
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
                            className="text-emerald-500"
                        />
                    )}
                </div>

                <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold tracking-widest text-emerald-700 uppercase">
                        Entidad del convenio
                    </p>
                    <h2
                        id="convenio-title"
                        className="mt-2 text-xl leading-tight font-bold text-gray-900"
                    >
                        {regulator.name}
                    </h2>

                    <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                        {regulatorDetails.map(([label, key]) => (
                            <div key={key}>
                                <dt className="text-xs font-medium text-gray-500">
                                    {label}
                                </dt>
                                <dd className="mt-0.5 font-semibold text-gray-800">
                                    {regulator[key] || '-'}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </div>

            <div className="mt-5 border-t border-emerald-200 pt-4">
                <p className="text-sm leading-6 font-medium text-gray-800">
                    El crédito será descontado por esta entidad.
                </p>
                <p className="mt-2 text-xs leading-5 text-gray-600">
                    RED UNISOL proporciona la infraestructura tecnológica
                    utilizada en este proceso.
                </p>
            </div>
        </section>
    );
}
