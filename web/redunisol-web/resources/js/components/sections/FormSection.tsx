import {
    CheckCircleIcon,
    MouseScrollIcon,
    UploadSimple,
    WarningCircleIcon,
    XIcon,
} from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useRef, useState } from 'react';

// ── Config interfaces ─────────────────────────────────────────────────────────

export interface FormFieldConfig {
    enabled: boolean;
    label: string;
}

export interface FormSectionConfig {
    cuil: FormFieldConfig;
    email: FormFieldConfig;
    celular: FormFieldConfig;
    terminos: FormFieldConfig;
    recibo: { enabled: boolean; label: string };
    provincia: { enabled: boolean; defaultValue?: string };
    situacionLaboral: FormFieldConfig & { defaultValue?: string };
    banco: FormFieldConfig & { defaultValue?: string };
}

const DEFAULT_CONFIG: FormSectionConfig = {
    cuil: { enabled: true, label: 'CUIL' },
    email: { enabled: true, label: 'Email' },
    celular: { enabled: true, label: 'Celular / WhatsApp' },
    terminos: {
        enabled: true,
        label: 'Acepto los Términos y Condiciones y la Política de Privacidad',
    },
    recibo: { enabled: true, label: 'Subí tu recibo de sueldo' },
    provincia: { enabled: true },
    situacionLaboral: {
        enabled: true,
        label: '¿Cuál es su situación laboral?',
    },
    banco: { enabled: true, label: '¿Cuál es su banco de cobro?' },
};

// ── Data ──────────────────────────────────────────────────────────────────────

const provincias = [
    'Córdoba',
    'Catamarca',
    'La Rioja',
    'Santa Fe',
    'Jujuy',
    'Especifica',
];

const situacionesLaborales = [
    'Empleado Publico Provincial',
    'Empleado Publico Municipal',
    'Empleado publico Nacional',
    'Empleado Privado',
    'Policia',
    'Jubilado Nacional',
    'Jubilado Provincial',
    'Jubilado Municipal',
    'Autonomo/Independiente',
    'Monotributista',
    'Pensionado',
    'Beneficiario de Plan Social',
    'Jubilado/Pensionado FUERA DE USO',
    'Docente',
];

const bancos = [
    'BANCO DE LA PROVINCIA DE CORDOBA S.A.',
    'BANCO DE LA NACION ARGENTINA',
    'BANCO DE LA PAMPA SOCIEDAD DE ECONOMÍA',
    'BANCO PROVINCIA DEL NEUQUÉN SOCIEDAD ANÓNIMA',
    'BANCO PATAGONIA S.A.',
    'BBVA BANCO FRANCES S.A.',
    'BANCO SANTANDER RIO S.A.',
    'BANCO DEL CHUBUT S.A.',
    'HSBC BANK ARGENTINA S.A.',
    'BANCO ITAU ARGENTINA S.A.',
    'BANCO MACRO S.A.',
    'BANCO DE GALICIA Y BUENOS AIRES S.A.U.',
    'BANCO DE LA PROVINCIA DE BUENOS AIRES',
    'INDUSTRIAL AND COMMERCIAL BANK OF CHINA',
    'CITIBANK N.A.',
    'BANCO BBVA ARGENTINA S.A.',
    'BANCO SUPERVIELLE S.A.',
    'BANCO DE LA CIUDAD DE BUENOS AIRES',
    'BANCO HIPOTECARIO S.A.',
    'BANCO DE SAN JUAN S.A.',
    'BANCO MUNICIPAL DE ROSARIO',
    'BANCO DE SANTA CRUZ S.A.',
    'BANCO DE CORRIENTES S.A.',
    'BANK OF CHINA LIMITED SUCURSAL BUENOS AI',
    'BRUBANK S.A.U.',
    'BIBANK S.A.',
    'OPEN BANK ARGENTINA S.A.',
    'JPMORGAN CHASE BANK, NATIONAL ASSOCIATION',
    'BANCO CREDICOOP COOPERATIVO LIMITADO',
    'BANCO DE VALORES S.A.',
    'BANCO ROELA S.A.',
    'BANCO MARIVA S.A.',
    'BNP PARIBAS',
    'BANCO PROVINCIA DE TIERRA DEL FUEGO',
    'BANCO DE LA REPUBLICA ORIENTAL DEL URUGU',
    'BANCO SAENZ S.A.',
    'BANCO MERIDIAN S.A.',
    'BANCO COMAFI SOCIEDAD ANONIMA',
    'BANCO DE INVERSION Y COMERCIO EXTERIOR S',
    'BANCO PIANO S.A.',
    'BANCO JULIO SOCIEDAD ANONIMA',
    'BANCO RIOJA SOCIEDAD ANONIMA UNIPERSONAL',
    'BANCO DEL SOL S.A.',
    'NUEVO BANCO DEL CHACO S. A.',
    'BANCO VOII S.A.',
    'BANCO DE FORMOSA S.A.',
    'BANCO CMF S.A.',
    'BANCO DE SANTIAGO DEL ESTERO S.A.',
    'BANCO INDUSTRIAL S.A.',
    'NUEVO BANCO DE SANTA FE SOCIEDAD ANONIMA',
    'BANCO CETELEM ARGENTINA S.A.',
    'BANCO DE SERVICIOS FINANCIEROS S.A.',
    'BANCO DE SERVICIOS Y TRANSACCIONES S.A.',
    'RCI BANQUE S.A.',
    'BACS BANCO DE CREDITO Y SECURITIZACION S',
    'BANCO MASVENTAS S.A.',
    'WILOBANK S.A.U.',
    'NUEVO BANCO DE ENTRE RÍOS S.A.',
    'BANCO COLUMBIA S.A.',
    'BANCO BICA S.A.',
    'BANCO DE COMERCIO S.A.',
    'BANCO SUCREDITO REGIONAL S.A.U.',
    'BANCO DINO S.A.',
    'COMPAÑIA FINANCIERA ARGENTINA S.A.',
    'VOLKSWAGEN FINANCIAL SERVICES COMPAÑIA F',
    'IUDU COMPAÑÍA FINANCIERA S.A.',
    'FCA COMPAÑIA FINANCIERA S.A.',
    'GPAT COMPAÑIA FINANCIERA S.A.U.',
    'MERCEDES-BENZ COMPAÑÍA FINANCIERA ARGENT',
    'ROMBO COMPAÑÍA FINANCIERA S.A.',
    'JOHN DEERE CREDIT COMPAÑÍA FINANCIERA S.',
    'PSA FINANCE ARGENTINA COMPAÑÍA FINANCIER',
    'TOYOTA COMPAÑÍA FINANCIERA DE ARGENTINA',
    'NARANJA DIGITAL COMPAÑÍA FINANCIERA S.A.',
    'MONTEMAR COMPANIA FINANCIERA S.A.',
    'REBA COMPAÑIA FINANCIERA S.A.',
    'CREDITO REGIONAL COMPAÑIA FINANCIERA S.A',
    'BANCO COINAG S.A.',
    'Otros',
];

// ── Form state interface ───────────────────────────────────────────────────────
// Named LeadFormData to avoid shadowing the browser's built-in FormData constructor.

interface LeadFormData {
    cuil: string;
    email: string;
    celular: string;
    terminos: boolean;
    recibo: File | null;
    provincia: string;
    situacionLaboral: string;
    banco: string;
}

const INITIAL_FORM: LeadFormData = {
    cuil: '',
    email: '',
    celular: '',
    terminos: false,
    recibo: null,
    provincia: '',
    situacionLaboral: '',
    banco: '',
};

// ── Shared style constants ────────────────────────────────────────────────────

const inputCls =
    'w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-[#1e2d3d] outline-none ' +
    'placeholder:text-gray-400 focus:border-[#6BAF92] focus:ring-1 focus:ring-[#6BAF92] transition';

const selectCls =
    'w-full appearance-none rounded-xl border border-gray-200 bg-white px-4 py-3 pr-10 text-sm ' +
    'text-[#1e2d3d] outline-none focus:border-[#6BAF92] focus:ring-1 focus:ring-[#6BAF92] transition';

const stepAnim = {
    initial: { opacity: 0, x: 24 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -24 },
    transition: { duration: 0.25, ease: 'easeInOut' as const },
};

// ── Step components ───────────────────────────────────────────────────────────

function Step1({
    formData,
    setFormData,
    cfg,
}: {
    formData: LeadFormData;
    setFormData: React.Dispatch<React.SetStateAction<LeadFormData>>;
    cfg: FormSectionConfig;
}) {
    return (
        <motion.div {...stepAnim} key="s1">
            <h2 className="mb-1 text-center text-2xl font-semibold text-[#1e2d3d]">
                Empezamos con tus datos
            </h2>
            <p className="mb-8 text-center text-sm text-gray-500">
                Así podemos contactarte con tu oferta personalizada
            </p>

            <div className="space-y-5">
                {cfg.cuil.enabled && (
                    <div>
                        <label className="mb-1.5 block text-sm text-gray-500">
                            {cfg.cuil.label}
                        </label>
                        <input
                            type="text"
                            inputMode="numeric"
                            placeholder="Ej: 20-12345678-3"
                            value={formData.cuil}
                            onChange={(e) =>
                                setFormData((p) => ({
                                    ...p,
                                    cuil: e.target.value,
                                }))
                            }
                            className={inputCls}
                        />
                    </div>
                )}

                {cfg.email.enabled && (
                    <div>
                        <label className="mb-1.5 block text-sm text-gray-500">
                            {cfg.email.label}
                        </label>
                        <input
                            type="email"
                            placeholder="Ej: juan@gmail.com"
                            value={formData.email}
                            onChange={(e) =>
                                setFormData((p) => ({
                                    ...p,
                                    email: e.target.value,
                                }))
                            }
                            className={inputCls}
                        />
                    </div>
                )}

                {cfg.celular.enabled && (
                    <div>
                        <label className="mb-1.5 block text-sm text-gray-500">
                            {cfg.celular.label}
                        </label>
                        <input
                            type="tel"
                            placeholder="Celular (ej: 3511234567)"
                            value={formData.celular}
                            onChange={(e) =>
                                setFormData((p) => ({
                                    ...p,
                                    celular: e.target.value,
                                }))
                            }
                            className={inputCls}
                        />
                    </div>
                )}

                {cfg.terminos.enabled && (
                    <label className="flex cursor-pointer items-start gap-3">
                        <div className="relative mt-0.5 shrink-0">
                            <input
                                type="checkbox"
                                checked={formData.terminos}
                                onChange={(e) =>
                                    setFormData((p) => ({
                                        ...p,
                                        terminos: e.target.checked,
                                    }))
                                }
                                className="h-4.5 w-4.5 cursor-pointer rounded border-gray-300 accent-[#6BAF92]"
                            />
                        </div>
                        <span className="text-sm leading-snug text-gray-500">
                            {cfg.terminos.label}
                        </span>
                    </label>
                )}
            </div>
        </motion.div>
    );
}

function Step2({
    formData,
    fileInputRef,
    onFileChange,
    onSkip,
    label,
    uploading,
    reciboUrl,
}: {
    formData: LeadFormData;
    fileInputRef: React.RefObject<HTMLInputElement>;
    onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onSkip: () => void;
    label: string;
    uploading: boolean;
    reciboUrl: string | null;
}) {
    const [dragging, setDragging] = useState(false);

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        // create synthetic event-like object
        const dt = new DataTransfer();
        dt.items.add(file);
        const synth = {
            target: { files: dt.files },
        } as unknown as React.ChangeEvent<HTMLInputElement>;
        onFileChange(synth);
    };

    return (
        <motion.div {...stepAnim} key="s2">
            <h2 className="mb-1 text-center text-2xl font-semibold text-[#1e2d3d]">
                {label}
            </h2>
            <p className="mb-8 text-center text-sm text-gray-500">
                Para darte una respuesta más rápida
            </p>

            <div
                role="button"
                tabIndex={0}
                aria-label="Seleccionar archivo"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) =>
                    e.key === 'Enter' && fileInputRef.current?.click()
                }
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={`mx-auto flex w-64 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 transition select-none ${
                    dragging
                        ? 'border-[#6BAF92] bg-[#6baf921a]'
                        : 'border-gray-300 bg-gray-50 hover:border-[#6BAF92] hover:bg-gray-100'
                }`}
            >
                <UploadSimple
                    size={40}
                    className="text-[#1e2d3d]"
                    weight="bold"
                />
                <p className="text-center text-base font-semibold text-[#1e2d3d]">
                    {formData.recibo
                        ? formData.recibo.name
                        : 'Hacé click para subir'}
                </p>
                <p className="text-center text-xs text-gray-400">
                    JPG, JPEG, PNG, GIF, PDF (Max 10MB)
                </p>
                {uploading && (
                    <p className="text-center text-xs text-[#6BAF92]">
                        Subiendo...
                    </p>
                )}
                {reciboUrl && !uploading && (
                    <p className="text-center text-xs font-semibold text-[#6BAF92]">
                        ✓ Subido correctamente
                    </p>
                )}
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.pdf,image/jpeg,image/png,image/gif,application/pdf"
                className="hidden"
                onChange={onFileChange}
            />

            <div className="mt-7 flex justify-center">
                <button
                    type="button"
                    onClick={onSkip}
                    className="rounded-full border border-[#1e2d3d] px-6 py-2.5 text-sm font-semibold text-[#1e2d3d] transition hover:bg-gray-50"
                >
                    Omitir por ahora
                </button>
            </div>
        </motion.div>
    );
}

function Step3({
    formData,
    setFormData,
}: {
    formData: LeadFormData;
    setFormData: React.Dispatch<React.SetStateAction<LeadFormData>>;
}) {
    return (
        <motion.div {...stepAnim} key="s3">
            <h2 className="mb-6 text-xl font-semibold text-[#1e2d3d]">
                ¿En qué provincia trabajás?
            </h2>
            <div className="grid grid-cols-3 gap-3">
                {provincias.map((prov) => {
                    const selected = formData.provincia === prov;
                    return (
                        <button
                            key={prov}
                            type="button"
                            onClick={() =>
                                setFormData((p) => ({ ...p, provincia: prov }))
                            }
                            className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                                selected
                                    ? 'border-[#1e2d3d] bg-[#1e2d3d] text-white'
                                    : 'border-gray-200 text-[#1e2d3d] hover:border-[#1e2d3d] hover:bg-gray-50'
                            }`}
                        >
                            {prov}
                        </button>
                    );
                })}
            </div>
        </motion.div>
    );
}

function ChevronDown() {
    return (
        <svg
            className="pointer-events-none absolute top-1/2 right-4 h-4 w-4 -translate-y-1/2 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
            />
        </svg>
    );
}

function Step4({
    formData,
    setFormData,
    cfg,
}: {
    formData: LeadFormData;
    setFormData: React.Dispatch<React.SetStateAction<LeadFormData>>;
    cfg: FormSectionConfig;
}) {
    return (
        <motion.div {...stepAnim} key="s4">
            <div className="space-y-6">
                {cfg.situacionLaboral.enabled && (
                    <div>
                        <label className="mb-2 block text-base font-semibold text-[#1e2d3d]">
                            {cfg.situacionLaboral.label}
                        </label>
                        <div className="relative">
                            <select
                                value={formData.situacionLaboral}
                                onChange={(e) =>
                                    setFormData((p) => ({
                                        ...p,
                                        situacionLaboral: e.target.value,
                                    }))
                                }
                                className={selectCls}
                            >
                                <option value="" disabled>
                                    Seleccione una opción
                                </option>
                                {situacionesLaborales.map((s) => (
                                    <option key={s} value={s}>
                                        {s}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown />
                        </div>
                    </div>
                )}

                {cfg.banco.enabled && (
                    <div>
                        <label className="mb-2 block text-base font-semibold text-[#1e2d3d]">
                            {cfg.banco.label}
                        </label>
                        <div className="relative">
                            <select
                                value={formData.banco}
                                onChange={(e) =>
                                    setFormData((p) => ({
                                        ...p,
                                        banco: e.target.value,
                                    }))
                                }
                                className={selectCls}
                            >
                                <option value="" disabled>
                                    Seleccione un banco
                                </option>
                                {bancos.map((b) => (
                                    <option key={b} value={b}>
                                        {b}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown />
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

function ResultModal({
    result,
    errorMessage,
    onClose,
    onReset,
}: {
    result: 'success' | 'error' | 'not_qualified';
    errorMessage: string | null;
    onClose: () => void;
    onReset: () => void;
}) {
    const isSuccess = result === 'success';
    const isNotQualified = result === 'not_qualified';

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 24 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 24 }}
                transition={{ type: 'spring', duration: 0.45, bounce: 0.3 }}
                className="relative w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close */}
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-4 right-4 rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                >
                    <XIcon size={18} />
                </button>

                {/* Icon */}
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{
                        type: 'spring',
                        delay: 0.12,
                        bounce: 0.55,
                        duration: 0.5,
                    }}
                    className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full ${
                        isSuccess
                            ? 'bg-[#6BAF9220]'
                            : isNotQualified
                              ? 'bg-amber-50'
                              : 'bg-red-50'
                    }`}
                >
                    {isSuccess ? (
                        <CheckCircleIcon
                            size={38}
                            weight="fill"
                            className="text-[#6BAF92]"
                        />
                    ) : (
                        <WarningCircleIcon
                            size={38}
                            weight="fill"
                            className={
                                isNotQualified
                                    ? 'text-amber-500'
                                    : 'text-red-500'
                            }
                        />
                    )}
                </motion.div>

                {/* Title */}
                <motion.h3
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mb-2 text-xl font-bold text-[#1e2d3d]"
                >
                    {isSuccess
                        ? '¡Solicitud enviada!'
                        : isNotQualified
                          ? 'No precalificás'
                          : 'Algo salió mal'}
                </motion.h3>

                {/* Description */}
                <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.26 }}
                    className="mb-7 text-sm leading-relaxed text-gray-500"
                >
                    {isSuccess
                        ? 'Hemos enviado tu solicitud a las entidades. Te contactaremos con la mejor oferta disponible.'
                        : isNotQualified
                          ? (errorMessage ??
                            'Tu situación no califica para esta solicitud.')
                          : (errorMessage ??
                            'Ocurrió un error al enviar tu solicitud. Revisá tu conexión y volvé a intentarlo.')}
                </motion.p>

                {/* Actions */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.32 }}
                    className="flex flex-col gap-3"
                >
                    {isSuccess ? (
                        <button
                            type="button"
                            onClick={() => {
                                onReset();
                                onClose();
                            }}
                            className="w-full rounded-full bg-[#1e2d3d] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#2d3f54]"
                        >
                            Listo
                        </button>
                    ) : isNotQualified ? (
                        <>
                            <button
                                type="button"
                                onClick={onClose}
                                className="w-full rounded-full bg-[#1e2d3d] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#2d3f54]"
                            >
                                Entendido
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    onReset();
                                    onClose();
                                }}
                                className="text-sm text-gray-400 transition hover:text-gray-600 hover:underline"
                            >
                                Empezar de nuevo
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={onClose}
                                className="w-full rounded-full bg-[#1e2d3d] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#2d3f54]"
                            >
                                Intentar de nuevo
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    onReset();
                                    onClose();
                                }}
                                className="text-sm text-gray-400 transition hover:text-gray-600 hover:underline"
                            >
                                Empezar de nuevo
                            </button>
                        </>
                    )}
                </motion.div>
            </motion.div>
        </motion.div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FormSection({
    config,
    landingSlug,
    landingTitle,
}: {
    config?: Partial<FormSectionConfig>;
    landingSlug: string;
    landingTitle: string;
}) {
    const cfg = useMemo(
        (): FormSectionConfig => ({
            ...DEFAULT_CONFIG,
            ...config,
            cuil: { ...DEFAULT_CONFIG.cuil, ...config?.cuil },
            email: { ...DEFAULT_CONFIG.email, ...config?.email },
            celular: { ...DEFAULT_CONFIG.celular, ...config?.celular },
            terminos: { ...DEFAULT_CONFIG.terminos, ...config?.terminos },
            recibo: { ...DEFAULT_CONFIG.recibo, ...config?.recibo },
            provincia: { ...DEFAULT_CONFIG.provincia, ...config?.provincia },
            situacionLaboral: {
                ...DEFAULT_CONFIG.situacionLaboral,
                ...config?.situacionLaboral,
            },
            banco: { ...DEFAULT_CONFIG.banco, ...config?.banco },
        }),
        [config],
    );

    const [step, setStep] = useState(1); // always starts at 1, which is always enabled
    const [result, setResult] = useState<
        'success' | 'error' | 'not_qualified' | null
    >(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [formData, setFormData] = useState<LeadFormData>(INITIAL_FORM);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [reciboUrl, setReciboUrl] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // Compute which steps are active based on config
    const enabledSteps = useMemo(() => {
        const steps: number[] = [1]; // Step 1 always active
        if (cfg.recibo.enabled) steps.push(2);
        if (cfg.provincia.enabled) steps.push(3);
        if (cfg.situacionLaboral.enabled || cfg.banco.enabled) steps.push(4);
        return steps;
    }, [cfg]);

    const currentStepIndex = enabledSteps.indexOf(step);
    const totalActiveSteps = enabledSteps.length;
    const progressPercent = ((currentStepIndex + 1) / totalActiveSteps) * 100;
    const isLastStep = currentStepIndex === enabledSteps.length - 1;

    const handleSubmit = async () => {
        setIsSubmitting(true);

        const params = new URLSearchParams(window.location.search);
        const payload: Record<string, string | boolean> = {
            landing_slug: landingSlug,
            landing_title: landingTitle,
            landing_url: window.location.href,
            terminos: formData.terminos,
        };

        if (formData.email) payload.email = formData.email;
        if (formData.celular) payload.celular = formData.celular;
        if (formData.cuil) payload.cuil = formData.cuil;
        if (cfg.provincia.enabled) {
            if (formData.provincia) payload.provincia = formData.provincia;
        } else if (cfg.provincia.defaultValue) {
            payload.provincia = cfg.provincia.defaultValue;
        }

        if (cfg.situacionLaboral.enabled) {
            if (formData.situacionLaboral)
                payload.situacion_laboral = formData.situacionLaboral;
        } else if (cfg.situacionLaboral.defaultValue) {
            payload.situacion_laboral = cfg.situacionLaboral.defaultValue;
        }

        if (cfg.banco.enabled) {
            if (formData.banco) payload.banco = formData.banco;
        } else if (cfg.banco.defaultValue) {
            payload.banco = cfg.banco.defaultValue;
        }
        if (reciboUrl) payload.recibo_url = reciboUrl;

        for (const key of [
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_term',
            'utm_content',
        ]) {
            const value = params.get(key);
            if (value) payload[key] = value;
        }

        try {
            const res = await fetch('/api/form-submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = (await res.json()) as {
                ok?: boolean;
                message?: string;
                qualified?: boolean;
            };

            if (!res.ok || data.ok === false) {
                setErrorMessage(data.message ?? null);
                setResult('error');
                return;
            }

            if (data.qualified === false) {
                setErrorMessage(data.message ?? null);
                setResult('not_qualified');
                return;
            }

            setErrorMessage(null);
            setResult('success');
        } catch {
            setErrorMessage(null);
            setResult('error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const goNext = () => {
        const nextIndex = currentStepIndex + 1;
        if (nextIndex < enabledSteps.length) {
            setStep(enabledSteps[nextIndex]);
        } else {
            void handleSubmit();
        }
    };

    const goBack = () => {
        const prevIndex = currentStepIndex - 1;
        if (prevIndex >= 0) setStep(enabledSteps[prevIndex]);
    };

    const handleReset = () => {
        setStep(1);
        setFormData(INITIAL_FORM);
        setReciboUrl(null);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] ?? null;
        setFormData((prev) => ({ ...prev, recibo: file }));
        setReciboUrl(null);
        if (!file) return;

        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('recibo', file);
            const res = await fetch('/api/recibos/upload', {
                method: 'POST',
                body: fd,
            });
            if (res.ok) {
                const data = (await res.json()) as { url: string };
                setReciboUrl(data.url);
            }
        } catch {
            // Upload failed silently — form still submits without file URL
        } finally {
            setUploading(false);
        }
    };

    return (
        <section className="w-full py-16">
            <div className="mx-auto max-w-lg px-4">
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                    {/* Step header */}
                    <div className="flex items-center justify-between px-6 pt-5 pb-3">
                        {enabledSteps.map((stepN, idx) => {
                            const pos = idx + 1;
                            const isActive = stepN === step;
                            const isDone = idx < currentStepIndex;
                            return (
                                <span
                                    key={stepN}
                                    className={`text-sm font-medium transition-colors ${
                                        isActive
                                            ? 'font-semibold text-[#1e2d3d]'
                                            : isDone
                                              ? 'text-[#6BAF92]'
                                              : 'text-gray-400'
                                    }`}
                                >
                                    Paso {pos}
                                </span>
                            );
                        })}
                    </div>

                    {/* Progress bar */}
                    <div className="relative h-0.75 w-full bg-[#1e2d3d]">
                        <motion.div
                            className="absolute top-0 left-0 h-full bg-[#6BAF92]"
                            initial={false}
                            animate={{ width: `${progressPercent}%` }}
                            transition={{ duration: 0.4, ease: 'easeInOut' }}
                        />
                    </div>

                    {/* Step content */}
                    <div className="min-h-125 overflow-hidden px-6 py-8">
                        <AnimatePresence mode="wait">
                            {step === 1 ? (
                                <Step1
                                    key="step1"
                                    formData={formData}
                                    setFormData={setFormData}
                                    cfg={cfg}
                                />
                            ) : step === 2 ? (
                                <Step2
                                    key="step2"
                                    formData={formData}
                                    fileInputRef={
                                        fileInputRef as React.RefObject<HTMLInputElement>
                                    }
                                    onFileChange={handleFileChange}
                                    onSkip={goNext}
                                    label={cfg.recibo.label}
                                    uploading={uploading}
                                    reciboUrl={reciboUrl}
                                />
                            ) : step === 3 ? (
                                <Step3
                                    key="step3"
                                    formData={formData}
                                    setFormData={setFormData}
                                />
                            ) : (
                                <Step4
                                    key="step4"
                                    formData={formData}
                                    setFormData={setFormData}
                                    cfg={cfg}
                                />
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Navigation buttons */}
                    <div className="px-6 pb-6">
                        <div
                            className={`flex items-center ${step > 1 ? 'justify-between' : 'justify-end'}`}
                        >
                            {step > 1 && (
                                <button
                                    type="button"
                                    onClick={goBack}
                                    disabled={isSubmitting}
                                    className="rounded-full border border-[#1e2d3d] px-6 py-2.5 text-sm font-semibold text-[#1e2d3d] transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Volver
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={goNext}
                                disabled={
                                    isSubmitting || (step === 2 && uploading)
                                }
                                className="rounded-full bg-[#1e2d3d] px-7 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2d3f54] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isLastStep
                                    ? isSubmitting
                                        ? 'Enviando...'
                                        : 'Enviar'
                                    : 'Continuar'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Scroll hint */}
                <div className="mt-8 flex items-center justify-center gap-3 pb-8">
                    <MouseScrollIcon size={24} className="text-[#8a9bb5]" />
                    <span className="text-normal font-bold text-[#8a9bb5]">
                        Scroll para seguir viendo
                    </span>
                </div>
            </div>

            {/* Result modal — rendered outside the card, fixed overlay */}
            <AnimatePresence>
                {result !== null && (
                    <ResultModal
                        result={result}
                        errorMessage={errorMessage}
                        onClose={() => {
                            setResult(null);
                            setErrorMessage(null);
                        }}
                        onReset={handleReset}
                    />
                )}
            </AnimatePresence>
        </section>
    );
}
