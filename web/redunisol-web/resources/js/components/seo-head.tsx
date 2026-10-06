import { Head, usePage } from '@inertiajs/react';
import { ReactNode } from 'react';

import { formatPageTitle } from '@/lib/seo';

interface SeoData {
    metaTitle?: string;
    metaDescription?: string;
    keyword?: string;
    robots?: string;
    canonical?: string;
    ogImage?: string;
    ogType?: string;
}

interface SeoHeadProps {
    title?: string;
    description?: string;
    keyword?: string;
    robots?: string;
    canonical?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    ogType?: string;
    schemas?: object[];
    children?: ReactNode;
}

export default function SeoHead({
    title,
    description,
    keyword,
    robots,
    canonical,
    ogTitle,
    ogDescription,
    ogImage,
    ogType,
    schemas = [],
    children,
}: SeoHeadProps) {
    const { seo = {}, name = 'Red Unisol' } = usePage<{
        seo?: SeoData;
        name?: string;
        [key: string]: unknown;
    }>().props;
    const fullTitle = formatPageTitle(title || seo.metaTitle || name, name);
    const metaDescription = description || seo.metaDescription || '';
    const metaKeyword = keyword || seo.keyword;
    const canonicalUrl = canonical || seo.canonical;
    const defaultOgImage =
        typeof window !== 'undefined'
            ? `${window.location.origin}/logo.jpeg`
            : 'https://redunisol.com.ar/logo.jpeg';
    const socialImage = ogImage || seo.ogImage || defaultOgImage;

    return (
        <Head>
            <title>{fullTitle}</title>
            <meta
                head-key="description"
                name="description"
                content={metaDescription}
            />
            {metaKeyword && (
                <meta
                    head-key="keywords"
                    name="keywords"
                    content={metaKeyword}
                />
            )}
            <meta
                head-key="robots"
                name="robots"
                content={robots || seo.robots || 'index, follow'}
            />
            {canonicalUrl && (
                <link
                    head-key="canonical"
                    rel="canonical"
                    href={canonicalUrl}
                />
            )}

            {/* Open Graph / Facebook */}
            <meta
                head-key="og:site_name"
                property="og:site_name"
                content={name}
            />
            <meta
                head-key="og:type"
                property="og:type"
                content={ogType || seo.ogType || 'website'}
            />
            <meta
                head-key="og:title"
                property="og:title"
                content={ogTitle ? formatPageTitle(ogTitle, name) : fullTitle}
            />
            <meta
                head-key="og:description"
                property="og:description"
                content={ogDescription || metaDescription}
            />
            <meta
                head-key="og:image"
                property="og:image"
                content={socialImage}
            />
            {canonicalUrl && (
                <meta
                    head-key="og:url"
                    property="og:url"
                    content={canonicalUrl}
                />
            )}

            {/* Twitter */}
            <meta
                head-key="twitter:card"
                name="twitter:card"
                content="summary_large_image"
            />
            <meta
                head-key="twitter:title"
                name="twitter:title"
                content={ogTitle ? formatPageTitle(ogTitle, name) : fullTitle}
            />
            <meta
                head-key="twitter:description"
                name="twitter:description"
                content={ogDescription || metaDescription}
            />
            <meta
                head-key="twitter:image"
                name="twitter:image"
                content={socialImage}
            />

            {/* JSON-LD Structured Data */}
            {schemas.map((schema, i) => (
                <script
                    key={`schema-${i}`}
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
                />
            ))}

            {children}
        </Head>
    );
}
