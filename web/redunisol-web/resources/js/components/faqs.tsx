// Components/FAQs.jsx

import { useState } from 'react';

function Item({ q, a }: any) {
    const [open, setOpen] = useState(false);

    return (
        <div className="border-b py-4">
            <button
                onClick={() => setOpen(!open)}
                className="w-full text-left font-medium"
            >
                {q}
            </button>

            {open && <p className="mt-2 text-sm text-gray-600">{a}</p>}
        </div>
    );
}

export default function FAQs() {
    return (
        <section className="mx-auto max-w-3xl px-6 py-20">
            <h2 className="mb-6 text-center text-2xl font-semibold">
                Preguntas frecuentes
            </h2>

            <Item
                q="¿Cuáles son los requisitos?"
                a="Ser empleado público, docente, policía o jubilado."
            />

            <Item
                q="¿Qué documentación necesito?"
                a="DNI, recibo de haberes y datos de contacto."
            />
        </section>
    );
}
