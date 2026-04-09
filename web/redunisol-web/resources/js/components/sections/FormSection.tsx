import {
    MouseScrollIcon,
    PaperPlaneTilt,
    UploadSimple,
} from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRef, useState } from 'react';

const TOTAL_STEPS = 4;

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

interface FormData {
    dni: string;
    email: string;
    celular: string;
    terminos: boolean;
    recibo: File | null;
    provincia: string;
    situacionLaboral: string;
    banco: string;
}

const INITIAL_FORM: FormData = {
    dni: '',
    email: '',
    celular: '',
    terminos: false,
    recibo: null,
    provincia: '',
    situacionLaboral: '',
    banco: '',
};

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

function Step1({
    formData,
    setFormData,
}: {
    formData: FormData;
    setFormData: React.Dispatch<React.SetStateAction<FormData>>;
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
                <div>
                    <label className="mb-1.5 block text-sm text-gray-500">
                        DNI
                    </label>
                    <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Ej: 12345678"
                        value={formData.dni}
                        onChange={(e) =>
                            setFormData((p) => ({ ...p, dni: e.target.value }))
                        }
                        className={inputCls}
                    />
                </div>

                <div>
                    <label className="mb-1.5 block text-sm text-gray-500">
                        Email
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

                <div>
                    <label className="mb-1.5 block text-sm text-gray-500">
                        Celular / WhatsApp
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
                        Acepto los Términos y Condiciones y la Política de
                        Privacidad
                    </span>
                </label>
            </div>
        </motion.div>
    );
}

function Step2({
    formData,
    fileInputRef,
    onFileChange,
    onSkip,
}: {
    formData: FormData;
    fileInputRef: React.RefObject<HTMLInputElement>;
    onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onSkip: () => void;
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
                Subí tu recibo de sueldo
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
    formData: FormData;
    setFormData: React.Dispatch<React.SetStateAction<FormData>>;
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
}: {
    formData: FormData;
    setFormData: React.Dispatch<React.SetStateAction<FormData>>;
}) {
    return (
        <motion.div {...stepAnim} key="s4">
            <div className="space-y-6">
                <div>
                    <label className="mb-2 block text-base font-semibold text-[#1e2d3d]">
                        ¿Cuál es su situación laboral?
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

                <div>
                    <label className="mb-2 block text-base font-semibold text-[#1e2d3d]">
                        ¿Cuál es su banco de cobro?
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
            </div>
        </motion.div>
    );
}

function SuccessScreen({ onReset }: { onReset: () => void }) {
    return (
        <motion.div
            key="success"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center justify-center gap-5 py-20 text-center"
        >
            <PaperPlaneTilt
                size={52}
                className="text-[#6BAF92]"
                weight="thin"
            />
            <p className="text-base text-gray-500">
                ¡Proceso de análisis finalizado!
            </p>
            <p className="max-w-xs text-lg leading-snug font-bold text-[#1e2d3d]">
                Hemos enviado tu solicitud a las entidades, bancos y/o
                financieras que mejor oferta pueden darte.
            </p>
            <button
                type="button"
                onClick={onReset}
                className="mt-1 text-sm font-medium text-[#6BAF92] hover:underline"
            >
                Mandar de nuevo
            </button>
        </motion.div>
    );
}

export default function FormSection() {
    const [step, setStep] = useState(1);
    const [submitted, setSubmitted] = useState(false);
    const [formData, setFormData] = useState<FormData>(INITIAL_FORM);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const goNext = () => {
        if (step < TOTAL_STEPS) {
            setStep((s) => s + 1);
        } else {
            setSubmitted(true);
        }
    };

    const goBack = () => {
        if (step > 1) setStep((s) => s - 1);
    };

    const handleReset = () => {
        setStep(1);
        setSubmitted(false);
        setFormData(INITIAL_FORM);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] ?? null;
        setFormData((prev) => ({ ...prev, recibo: file }));
    };

    const progressPercent = (step / TOTAL_STEPS) * 100;

    return (
        <section className="w-full py-16">
            <div className="mx-auto max-w-lg px-4">
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                    {!submitted && (
                        <>
                            <div className="flex items-center justify-between px-6 pt-5 pb-3">
                                {Array.from({ length: TOTAL_STEPS }, (_, i) => {
                                    const n = i + 1;
                                    const isActive = n === step;
                                    const isDone = n < step;
                                    return (
                                        <span
                                            key={n}
                                            className={`text-sm font-medium transition-colors ${
                                                isActive
                                                    ? 'font-semibold text-[#1e2d3d]'
                                                    : isDone
                                                      ? 'text-[#6BAF92]'
                                                      : 'text-gray-400'
                                            }`}
                                        >
                                            Paso {n}
                                        </span>
                                    );
                                })}
                            </div>

                            <div className="relative h-0.75 w-full bg-[#1e2d3d]">
                                <motion.div
                                    className="absolute top-0 left-0 h-full bg-[#6BAF92]"
                                    initial={false}
                                    animate={{ width: `${progressPercent}%` }}
                                    transition={{
                                        duration: 0.4,
                                        ease: 'easeInOut',
                                    }}
                                />
                            </div>
                        </>
                    )}

                    <div className="min-h-125 overflow-hidden px-6 py-8">
                        <AnimatePresence mode="wait">
                            {submitted ? (
                                <SuccessScreen
                                    key="success"
                                    onReset={handleReset}
                                />
                            ) : step === 1 ? (
                                <Step1
                                    key="step1"
                                    formData={formData}
                                    setFormData={setFormData}
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
                                />
                            )}
                        </AnimatePresence>
                    </div>

                    {!submitted && (
                        <div
                            className={`flex items-center px-6 pb-6 ${step > 1 ? 'justify-between' : 'justify-end'}`}
                        >
                            {step > 1 && (
                                <button
                                    type="button"
                                    onClick={goBack}
                                    className="rounded-full border border-[#1e2d3d] px-6 py-2.5 text-sm font-semibold text-[#1e2d3d] transition hover:bg-gray-50"
                                >
                                    Volver
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={goNext}
                                className="rounded-full bg-[#1e2d3d] px-7 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2d3f54]"
                            >
                                Continuar
                            </button>
                        </div>
                    )}
                </div>

                <div className="mt-8 flex items-center justify-center gap-3 pb-8">
                    <MouseScrollIcon size={24} className="text-[#8a9bb5]" />
                    <span className="text-normal font-bold text-[#8a9bb5]">
                        Scroll para seguir viendo
                    </span>
                </div>
            </div>
        </section>
    );
}
