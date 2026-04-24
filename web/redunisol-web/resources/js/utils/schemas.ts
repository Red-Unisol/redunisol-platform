import { type FAQsData } from '@/components/faqs';
import { type ServicesData } from '@/components/services';

export interface OrganizationSchemaProps {
    name?: string;
    url?: string;
    logo?: string;
    description?: string;
    email?: string;
    sameAs?: string[];
}

export function organizationSchema(props: OrganizationSchemaProps = {}) {
    return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: props.name ?? 'Red Unisol',
        url: props.url ?? 'https://redunisol.com.ar',
        logo:
            props.logo ??
            'https://redunisol.com.ar/images/general/t1JdNn2n4csoI8qGYVfVNKs7w.png',
        description:
            props.description ??
            'Red de Mutuales que ofrece ayudas económicas y créditos personales en Argentina',
        email: props.email ?? 'info@redunisol.com.ar',
        sameAs: props.sameAs ?? [
            'https://www.facebook.com/redunisol',
            'https://www.linkedin.com/company/redunisol/',
            'https://www.instagram.com/redunisol_prestamos/',
            'https://www.youtube.com/@redunisol5007',
        ],
        areaServed: {
            '@type': 'Country',
            name: 'Argentina',
        },
    };
}

export function serviceSchema(services: ServicesData) {
    return {
        '@context': 'https://schema.org',
        '@type': 'FinancialService',
        name: `Red Unisol – ${services.title}`,
        provider: { '@type': 'Organization', name: 'Red Unisol' },
        description: services.description,
        areaServed: { '@type': 'Country', name: 'Argentina' },
        hasOfferCatalog: {
            '@type': 'OfferCatalog',
            name: services.title,
            itemListElement: services.items.map((item, i) => ({
                '@type': 'Offer',
                position: i + 1,
                itemOffered: {
                    '@type': 'LoanOrCredit',
                    name: item.text,
                },
            })),
        },
    };
}

export function faqSchema(faqs: FAQsData) {
    const allFaqs = faqs.categories.flatMap((cat) => cat.items);
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: allFaqs.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: {
                '@type': 'Answer',
                text: item.a,
            },
        })),
    };
}

export function breadcrumbSchema(items: { name: string; url: string }[]) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: item.name,
            item: item.url,
        })),
    };
}
