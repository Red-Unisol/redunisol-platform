import type { FAQsData } from '@/components/faqs';

export const platformName = 'RED UNISOL OPERACIONES S.A.';
export const platformContact = 'info@redunisol.com.ar';
export const platformDescription =
    'Red Unisol recibe tu solicitud y la envía a la entidad otorgante. Le ofrece servicios de scoring y gestión de riesgo para apoyar la evaluación. La entidad otorgante decide si aprueba o rechaza la solicitud.';

const requestAnswer =
    'Completás el formulario con tus datos. Red Unisol gestiona y envía la solicitud a la entidad otorgante. La entidad puede pedirte documentación adicional y decide si aprueba o rechaza la solicitud.';

const timingAnswer =
    'Los plazos dependen de la documentación, el convenio y la evaluación de la entidad otorgante. Si la solicitud avanza, te informaremos los pasos correspondientes.';

const faqAnswers = new Map([
    ['¿Cómo se solicita un préstamo?', requestAnswer],
    ['¿Cómo es el proceso de solicitud del préstamo?', requestAnswer],
    [
        '¿La solicitud es 100% online?',
        'Podés iniciar la solicitud desde el formulario online. Los pasos siguientes dependen de la entidad otorgante y de la línea.',
    ],
    ['¿Cuánto tarda la evaluación?', timingAnswer],
    ['¿Cuánto tiempo demora la aprobación?', timingAnswer],
    [
        '¿El monto y la aprobación están garantizados?',
        'No. La entidad otorgante evalúa la solicitud y, si la aprueba, define el monto y las condiciones de financiación.',
    ],
    [
        '¿Puedo consultar por una solicitud ya iniciada?',
        `Para consultas sobre el formulario, la verificación de identidad o el estado de tu solicitud en la plataforma, escribinos a ${platformContact}. Para consultas sobre el contrato, cuotas o pagos, usá el canal indicado por la entidad otorgante.`,
    ],
]);

export function homePlatformSectionData(
    type: string,
    data: Record<string, unknown>,
): Record<string, unknown> {
    switch (type) {
        case 'hero':
            return {
                ...data,
                description: platformDescription,
                socialProof: undefined,
            };
        case 'about':
            return {
                ...data,
                description: `${platformName} opera la plataforma Red Unisol, que conecta a quienes solicitan financiación con entidades otorgantes. Si una solicitud es aprobada, el préstamo o la ayuda económica se contrata con la entidad otorgante.`,
                extra: undefined,
            };
        case 'regulatory':
            return { ...data, title: 'Entidades participantes' };
        case 'faqs': {
            const categories = (data.categories ??
                []) as FAQsData['categories'];
            return {
                ...data,
                description:
                    'Encontrá respuestas a las **preguntas más frecuentes** sobre la solicitud de un préstamo.',
                categories: categories.map((category) => ({
                    ...category,
                    items: category.items.map((item) => ({
                        ...item,
                        a: faqAnswers.get(item.q) ?? item.a,
                    })),
                })),
            };
        }
        default:
            return data;
    }
}
