import { usePage } from '@inertiajs/react';
import {
    CheckCircle,
    EnvelopeSimple,
    FacebookLogo,
    ShieldCheck,
    WarningCircle,
    WhatsappLogo,
} from '@phosphor-icons/react';
import { createElement, useEffect, useMemo, useRef, useState } from 'react';

import ConventionCard, {
    type ConvenioRegulator,
} from '@/components/convenio-card';
import Footer from '@/components/footer';
import Navbar from '@/components/navbar';

interface FinalizarSettings {
    heading: string;
    subheading: string;
    contact_question: string;
    tna: string;
    tea: string;
    tnm: string;
    cft: string;
    terms_url: string;
    contact_email: string;
    whatsapp_url: string;
    facebook_url: string;
}

interface LoanData {
    solicitud: string;
    ntrans: string;
    linea: string;
    nombre: string;
    monto_total: string;
    monto_total_display: string;
    monto_cuota: string;
    monto_cuota_display: string;
    cuotas: string;
    prestamo_cft: string;
    prestamo_tem: string;
    prestamo_tna: string;
    prestamo_tea: string;
    numero_prestamo: string;
    capital_original: string;
    monto_prestamo: string;
    primer_vencimiento: string;
    vencimiento: string;
}

interface MetamapConfig {
    client_id: string;
    flow_id: string;
    doc_id: string;
    extra_html: string;
    metadata: Record<string, unknown> | null;
}

interface FinalizarPayload {
    linea: string;
    line_label: string;
    loan: LoanData | null;
    metamap: MetamapConfig;
    error: string | null;
    regulator: ConvenioRegulator | null;
}

interface PageProps {
    settings: FinalizarSettings;
    finalizar: FinalizarPayload;
    [key: string]: unknown;
}

type VerificationState = 'idle' | 'started' | 'finished' | 'exited';

function SummaryItem({
    label,
    value,
    prominent = false,
}: {
    label: string;
    value?: string | null;
    prominent?: boolean;
}) {
    return (
        <div>
            <dt className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                {label}
            </dt>
            <dd
                className={`mt-1 font-bold text-gray-900 sm:mt-2 ${
                    prominent ? 'text-2xl sm:text-4xl' : 'text-sm sm:text-lg'
                }`}
            >
                {value || <span className="text-gray-300">-</span>}
            </dd>
        </div>
    );
}

function RateItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-2.5 last:border-0 sm:py-3">
            <span className="text-sm text-gray-600">{label}</span>
            <span className="text-sm font-semibold text-gray-800">
                {value ? `${value}%` : <span className="text-gray-400">-</span>}
            </span>
        </div>
    );
}

function useMetamapScript() {
    const [status, setStatus] = useState<'idle' | 'ready' | 'error'>('idle');

    useEffect(() => {
        const existing = document.getElementById(
            'metamap-web-button-sdk',
        ) as HTMLScriptElement | null;

        if (existing) {
            if (existing.dataset.loaded === 'true') {
                queueMicrotask(() => setStatus('ready'));
                return;
            }

            const onLoad = () => setStatus('ready');
            const onError = () => setStatus('error');

            existing.addEventListener('load', onLoad);
            existing.addEventListener('error', onError);

            return () => {
                existing.removeEventListener('load', onLoad);
                existing.removeEventListener('error', onError);
            };
        }

        const script = document.createElement('script');
        script.id = 'metamap-web-button-sdk';
        script.src = 'https://web-button.metamap.com/button.js';
        script.async = true;
        script.onload = () => {
            script.dataset.loaded = 'true';
            setStatus('ready');
        };
        script.onerror = () => setStatus('error');
        document.body.appendChild(script);
    }, []);

    return status;
}

export default function Finalizar() {
    const { settings, finalizar } = usePage<PageProps>().props;
    const scriptStatus = useMetamapScript();
    const metamapButtonRef = useRef<HTMLElement | null>(null);
    const [verificationState, setVerificationState] =
        useState<VerificationState>('idle');

    const loan = finalizar.loan;
    const hasLoanData = Boolean(loan);
    const metamapReady = Boolean(
        hasLoanData &&
        finalizar.metamap.client_id &&
        finalizar.metamap.flow_id &&
        finalizar.metamap.doc_id &&
        finalizar.metamap.metadata &&
        scriptStatus === 'ready',
    );

    const metadata = useMemo(() => {
        return finalizar.metamap.metadata
            ? JSON.stringify(finalizar.metamap.metadata)
            : '';
    }, [finalizar.metamap.metadata]);

    useEffect(() => {
        const button = metamapButtonRef.current;

        if (!button) {
            return;
        }

        const onStarted = () => setVerificationState('started');
        const onFinished = () => setVerificationState('finished');
        const onExited = () => setVerificationState('exited');

        button.addEventListener('metamap:userStartedSdk', onStarted);
        button.addEventListener('metamap:userFinishedSdk', onFinished);
        button.addEventListener('metamap:exitedSdk', onExited);

        button.addEventListener('mati:loaded', onStarted);
        button.addEventListener('mati:userFinishedSdk', onFinished);
        button.addEventListener('mati:exitedSdk', onExited);

        return () => {
            button.removeEventListener('metamap:userStartedSdk', onStarted);
            button.removeEventListener('metamap:userFinishedSdk', onFinished);
            button.removeEventListener('metamap:exitedSdk', onExited);
            button.removeEventListener('mati:loaded', onStarted);
            button.removeEventListener('mati:userFinishedSdk', onFinished);
            button.removeEventListener('mati:exitedSdk', onExited);
        };
    }, [metamapReady, metadata]);

    const rates = {
        tna: loan?.prestamo_tna || settings.tna,
        tea: loan?.prestamo_tea || settings.tea,
        tem: loan?.prestamo_tem || settings.tnm,
        cft: loan?.prestamo_cft || settings.cft,
    };

    const installmentPlan =
        loan?.cuotas && loan?.monto_cuota_display
            ? `${loan.cuotas} cuotas de ${loan.monto_cuota_display}`
            : '';

    return (
        <div className="flex min-h-screen flex-col bg-gray-50">
            <Navbar sections={[]} activeId={null} onNavigate={() => {}} />

            <main className="flex flex-1 flex-col items-center px-3 pt-20 pb-32 sm:px-6 sm:py-16">
                <div className="w-full max-w-2xl">
                    <header className="mb-5 text-center sm:mb-10">
                        <p className="mb-3 hidden text-xs font-bold tracking-[0.2em] text-emerald-600 uppercase sm:block">
                            ACEPTÁ TU CRÉDITO
                        </p>
                        <h1 className="text-2xl leading-tight font-extrabold tracking-tight text-gray-900 sm:text-4xl">
                            Revisá y aceptá tu crédito
                        </h1>
                        <p className="mx-auto mt-2 max-w-xl text-sm leading-5 text-gray-600 sm:mt-4 sm:text-base sm:leading-7">
                            Verificá las condiciones de tu crédito antes de
                            continuar.
                        </p>
                    </header>

                    {finalizar.error && (
                        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 shadow-sm">
                            <div className="flex gap-3">
                                <WarningCircle
                                    size={20}
                                    weight="fill"
                                    className="mt-0.5 shrink-0"
                                />
                                <span>{finalizar.error}</span>
                            </div>
                        </div>
                    )}

                    <section
                        aria-labelledby="credit-summary-title"
                        className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm sm:mb-6 sm:rounded-2xl"
                    >
                        <div className="border-b border-emerald-100 bg-linear-to-br from-emerald-50 to-white px-4 py-4 sm:px-7 sm:py-7">
                            <p className="text-xs font-medium text-emerald-700 sm:text-sm">
                                Crédito para
                            </p>
                            <h2
                                id="credit-summary-title"
                                className="mt-1 text-lg leading-tight font-bold text-gray-900 sm:text-2xl"
                            >
                                {loan?.nombre || '-'}
                            </h2>
                        </div>

                        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4 sm:gap-6 sm:px-7 sm:py-7">
                            <div className="col-span-2">
                                <SummaryItem
                                    label="Monto del crédito"
                                    value={loan?.monto_total_display}
                                    prominent
                                />
                            </div>
                            <SummaryItem
                                label="Plan de cuotas"
                                value={installmentPlan}
                            />
                            <SummaryItem
                                label="Número de solicitud"
                                value={
                                    loan?.solicitud ? `#${loan.solicitud}` : ''
                                }
                            />
                        </dl>
                    </section>

                    {finalizar.regulator && (
                        <ConventionCard regulator={finalizar.regulator} />
                    )}

                    <section
                        aria-labelledby="identity-verification-title"
                        className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:mb-6 sm:rounded-2xl sm:p-7"
                    >
                        <div className="mb-3 flex items-center gap-3 sm:mb-5 sm:items-start sm:gap-4">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 sm:h-11 sm:w-11">
                                <ShieldCheck
                                    size={23}
                                    className="text-emerald-600"
                                    weight="duotone"
                                />
                            </div>
                            <div>
                                <h2
                                    id="identity-verification-title"
                                    className="text-lg font-bold text-gray-900 sm:text-xl"
                                >
                                    Verificá tu identidad
                                </h2>
                            </div>
                        </div>

                        {finalizar.metamap.extra_html && (
                            <div
                                className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950 sm:mb-5 sm:rounded-xl sm:px-4 sm:py-4 sm:text-sm [&_a]:font-semibold [&_a]:text-amber-800 [&_a]:underline"
                                dangerouslySetInnerHTML={{
                                    __html: finalizar.metamap.extra_html,
                                }}
                            />
                        )}

                        {verificationState === 'started' && (
                            <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-800 sm:mb-5 sm:rounded-xl sm:px-4 sm:py-3 sm:text-sm">
                                La validación de identidad está en curso.
                            </div>
                        )}

                        {verificationState === 'finished' && (
                            <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-emerald-900 sm:mb-5 sm:rounded-xl sm:px-4 sm:py-4">
                                <div className="flex gap-3">
                                    <CheckCircle
                                        size={24}
                                        weight="fill"
                                        className="shrink-0 text-emerald-600"
                                    />
                                    <div>
                                        <p className="font-bold">
                                            Identidad validada correctamente
                                        </p>
                                        <p className="mt-1 text-sm leading-6 text-emerald-800">
                                            La información fue enviada para
                                            continuar con el proceso.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {verificationState === 'exited' && (
                            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 sm:mb-5 sm:rounded-xl sm:px-4 sm:py-3 sm:text-sm">
                                La validación no fue completada. Podés volver a
                                iniciarla cuando quieras.
                            </div>
                        )}

                        <div className="fixed right-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 z-40 overflow-hidden rounded-xl border border-gray-200 bg-white p-2 shadow-2xl sm:static sm:rounded-xl sm:bg-transparent sm:p-0 sm:shadow-none">
                            <div
                                aria-disabled={!metamapReady}
                                className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg bg-[#4a7cdc] px-3 py-3 text-center transition-opacity sm:min-h-28 sm:gap-3 sm:rounded-none sm:px-5 sm:py-5 ${
                                    metamapReady
                                        ? ''
                                        : 'pointer-events-none opacity-50'
                                }`}
                            >
                                {metamapReady ? (
                                    <>
                                        <p className="text-sm font-bold text-white">
                                            Verificar mi identidad y continuar
                                        </p>
                                        {createElement('metamap-button', {
                                            ref: metamapButtonRef,
                                            clientid:
                                                finalizar.metamap.client_id,
                                            flowid: finalizar.metamap.flow_id,
                                            metadata,
                                        })}
                                    </>
                                ) : scriptStatus === 'idle' ? (
                                    <span className="text-sm font-semibold text-white">
                                        Cargando validación de identidad…
                                    </span>
                                ) : scriptStatus === 'error' ? (
                                    <span className="text-sm font-semibold text-white">
                                        No pudimos cargar la validación de
                                        identidad.
                                    </span>
                                ) : (
                                    <span className="text-sm font-semibold text-white">
                                        Validación no disponible
                                    </span>
                                )}
                            </div>
                        </div>
                    </section>

                    <section
                        aria-labelledby="financial-conditions-title"
                        className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm sm:mb-6 sm:rounded-2xl sm:px-7 sm:py-6"
                    >
                        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                            <h2
                                id="financial-conditions-title"
                                className="text-sm font-bold text-gray-800"
                            >
                                Condiciones financieras
                            </h2>
                            {settings.terms_url && (
                                <a
                                    href={settings.terms_url}
                                    className="text-sm font-semibold text-emerald-600 underline underline-offset-2 transition-colors hover:text-emerald-700"
                                >
                                    Términos y condiciones
                                </a>
                            )}
                        </div>

                        <div>
                            <RateItem
                                label="Tasa Nominal Anual (TNA)"
                                value={rates.tna}
                            />
                            <RateItem
                                label="Tasa Efectiva Anual (TEA)"
                                value={rates.tea}
                            />
                            <RateItem
                                label="Tasa Nominal Mensual (TEM)"
                                value={rates.tem}
                            />
                            <RateItem
                                label="Costo Financiero Total Efectivo Anual (CFT)"
                                value={rates.cft}
                            />
                        </div>
                    </section>

                    <section className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm sm:rounded-2xl sm:px-7 sm:py-6">
                        <p className="mb-3 text-center text-sm font-semibold text-gray-700 sm:mb-5">
                            {settings.contact_question ||
                                '¿Tiene otra consulta para hacernos?'}
                        </p>

                        <div className="flex flex-col gap-2 sm:gap-3">
                            {settings.contact_email && (
                                <a
                                    href={`mailto:${settings.contact_email}`}
                                    className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700 transition-all hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                                >
                                    <EnvelopeSimple
                                        size={18}
                                        className="shrink-0 text-emerald-600"
                                        weight="duotone"
                                    />
                                    <span>
                                        Escribinos por mail a{' '}
                                        <strong>
                                            {settings.contact_email}
                                        </strong>
                                    </span>
                                </a>
                            )}

                            {settings.whatsapp_url && (
                                <a
                                    href={settings.whatsapp_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700 transition-all hover:border-green-200 hover:bg-green-50 hover:text-green-700"
                                >
                                    <WhatsappLogo
                                        size={18}
                                        className="shrink-0 text-green-500"
                                        weight="fill"
                                    />
                                    <span>
                                        Contactanos por{' '}
                                        <strong>WhatsApp</strong>
                                    </span>
                                </a>
                            )}

                            {settings.facebook_url && (
                                <a
                                    href={settings.facebook_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                                >
                                    <FacebookLogo
                                        size={18}
                                        className="shrink-0 text-blue-600"
                                        weight="fill"
                                    />
                                    <span>
                                        o a nuestro{' '}
                                        <strong>Facebook Messenger</strong>
                                    </span>
                                </a>
                            )}
                        </div>
                    </section>
                </div>
            </main>

            <Footer showWhatsAppButton={false} />
        </div>
    );
}
