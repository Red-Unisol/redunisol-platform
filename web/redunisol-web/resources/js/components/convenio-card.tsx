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
            className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm sm:mb-6 sm:rounded-2xl sm:p-6"
        >
            <div className="flex items-start gap-3 sm:items-center sm:gap-5">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white p-2 sm:h-28 sm:w-36 sm:rounded-xl sm:px-4 sm:py-3">
                    {regulator.logo_url ? (
                        <img
                            src={regulator.logo_url}
                            alt={`Logo de ${regulator.name}`}
                            className="max-h-14 max-w-full object-contain sm:max-h-20"
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
                    <p className="text-[10px] font-bold tracking-widest text-emerald-700 uppercase sm:text-xs">
                        Entidad del convenio
                    </p>
                    <h2
                        id="convenio-title"
                        className="mt-1 text-base leading-tight font-bold text-gray-900 sm:mt-2 sm:text-xl"
                    >
                        {regulator.name}
                    </h2>

                    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:mt-4 sm:gap-3 sm:text-sm">
                        {regulatorDetails.map(([label, key]) => (
                            <div key={key}>
                                <dt className="text-[10px] font-medium text-gray-500 sm:text-xs">
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

            <div className="mt-3 border-t border-emerald-200 pt-3 sm:mt-5 sm:pt-4">
                <p className="text-xs leading-5 font-medium text-gray-800 sm:text-sm sm:leading-6">
                    El crédito será descontado por esta entidad.
                </p>
                <p className="mt-1 text-[11px] leading-4 text-gray-600 sm:mt-2 sm:text-xs sm:leading-5">
                    RED UNISOL proporciona la infraestructura tecnológica
                    utilizada en este proceso.
                </p>
            </div>
        </section>
    );
}
