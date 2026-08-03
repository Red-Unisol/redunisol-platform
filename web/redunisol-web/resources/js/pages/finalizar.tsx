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

function RateItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4 border-b border-gray-100 py-2 last:border-0">
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
                setStatus('ready');
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
    const [verificationState, setVerificationState] = useState<
        'idle' | 'started' | 'finished' | 'exited'
    >('idle');

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

    return (
        <div className="flex min-h-screen flex-col bg-gray-50">
            <Navbar sections={[]} activeId={null} onNavigate={() => {}} />

            <main className="flex flex-1 flex-col items-center justify-center px-4 py-16 sm:px-6">
                <div className="w-full max-w-lg">
                    <div className="mb-10 text-center">
                        <p className="mb-2 text-xs font-bold tracking-widest text-emerald-600 uppercase">
                            Acepta tu Credito
                        </p>
                        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900">
                            {settings.heading || 'Termina tu Solicitud'}
                        </h1>
                        <p className="mt-4 text-base text-gray-500">
                            {settings.subheading ||
                                'Su prestamo sera descontado de la siguiente forma:'}
                        </p>
                    </div>

                    {finalizar.regulator && (
                        <ConventionCard regulator={finalizar.regulator} />
                    )}

                    {verificationState === 'finished' && (
                        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-5 text-center shadow-sm">
                            <CheckCircle
                                size={32}
                                weight="fill"
                                className="mx-auto mb-3 text-emerald-600"
                            />
                            <p className="text-base font-bold text-emerald-900">
                                Validacion enviada correctamente
                            </p>
                            <p className="mt-2 text-sm text-emerald-800">
                                Un asesor revisara la informacion para continuar
                                con el proceso.
                            </p>
                        </div>
                    )}

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

                    <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                        <div className="bg-linear-to-br from-emerald-50 to-white px-8 py-8 text-center">
                            {loan?.nombre && (
                                <p className="mb-4 text-sm font-bold tracking-wide text-gray-700 uppercase">
                                    {loan.nombre}
                                </p>
                            )}

                            {loan?.cuotas && loan?.monto_cuota_display ? (
                                <p className="text-2xl font-light text-gray-700">
                                    EN{' '}
                                    <span className="font-extrabold text-emerald-600">
                                        {loan.cuotas} CUOTAS
                                    </span>{' '}
                                    DE{' '}
                                    <span className="font-extrabold text-emerald-600">
                                        {loan.monto_cuota_display}
                                    </span>
                                </p>
                            ) : (
                                <p className="text-lg font-semibold text-gray-400">
                                    EN{' '}
                                    <span className="text-emerald-500">
                                        CUOTAS
                                    </span>{' '}
                                    DE
                                </p>
                            )}
                        </div>

                        <div className="divide-y divide-gray-100 px-8 py-4">
                            <div className="flex items-center justify-between gap-4 py-3">
                                <span className="text-sm font-medium text-gray-500">
                                    Monto de tu Credito
                                </span>
                                <span className="text-base font-bold text-gray-800">
                                    {loan?.monto_total_display || (
                                        <span className="text-gray-300">-</span>
                                    )}
                                </span>
                            </div>

                            <div className="flex items-center justify-between gap-4 py-3">
                                <span className="text-sm font-medium text-gray-500">
                                    Numero de Solicitud
                                </span>
                                <span className="text-base font-bold text-gray-800">
                                    {loan?.solicitud ? (
                                        `#${loan.solicitud}`
                                    ) : (
                                        <span className="text-gray-300">-</span>
                                    )}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                        <div className="flex items-stretch gap-0">
                            <div className="flex items-center justify-center border-r border-gray-200 bg-gray-50 px-6 py-5">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-inner">
                                    <ShieldCheck
                                        size={24}
                                        className="text-emerald-500"
                                        weight="duotone"
                                    />
                                </div>
                            </div>

                            <div
                                className={`flex min-h-20 flex-1 items-center justify-center bg-[#4a7cdc] px-4 py-4 transition-opacity ${
                                    metamapReady
                                        ? ''
                                        : 'pointer-events-none opacity-50'
                                }`}
                            >
                                {metamapReady ? (
                                    createElement('metamap-button', {
                                        ref: metamapButtonRef,
                                        clientid: finalizar.metamap.client_id,
                                        flowid: finalizar.metamap.flow_id,
                                        metadata,
                                    })
                                ) : (
                                    <span className="text-sm font-semibold text-white">
                                        Validacion no disponible
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {finalizar.metamap.extra_html && (
                        <div
                            className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-5 text-sm text-amber-950 shadow-sm [&_a]:font-semibold [&_a]:text-amber-800 [&_a]:underline"
                            dangerouslySetInnerHTML={{
                                __html: finalizar.metamap.extra_html,
                            }}
                        />
                    )}

                    <div className="mb-6 rounded-2xl border border-gray-200 bg-white px-6 py-6 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-4">
                            <p className="text-xs font-bold tracking-widest text-gray-500 uppercase">
                                Condiciones Financieras
                            </p>
                            {settings.terms_url && (
                                <a
                                    href={settings.terms_url}
                                    className="text-xs font-semibold text-emerald-600 underline underline-offset-2 transition-colors hover:text-emerald-700"
                                >
                                    Terminos y condiciones
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
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-white px-6 py-6 shadow-sm">
                        <p className="mb-5 text-center text-sm font-semibold text-gray-700">
                            {settings.contact_question ||
                                'Tiene otra consulta para hacernos?'}
                        </p>

                        <div className="flex flex-col gap-3">
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
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}
