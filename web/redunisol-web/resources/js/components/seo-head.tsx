import { Head } from '@inertiajs/react';
import { ReactNode } from 'react';

interface SeoHeadProps {
    title: string;
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
    robots = 'index, follow',
    canonical,
    ogTitle,
    ogDescription,
    ogImage,
    ogType = 'website',
    schemas = [],
    children,
}: SeoHeadProps) {
    const appName = 'Red Unisol';
    const fullTitle = title.includes(appName) ? title : `${title} | ${appName}`;
    const defaultOgImage =
        typeof window !== 'undefined'
            ? `${window.location.origin}/logo.jpeg`
            : 'https://redunisol.com.ar/logo.jpeg';
    const socialImage = ogImage || defaultOgImage;

    return (
        <Head>
            <title>{fullTitle}</title>
            <meta name="description" content={description || ''} />
            {keyword && <meta name="keywords" content={keyword} />}
            <meta name="robots" content={robots} />
            {canonical && <link rel="canonical" href={canonical} />}

            {/* Open Graph / Facebook */}
            <meta property="og:type" content={ogType} />
            <meta property="og:title" content={ogTitle || title} />
            {ogDescription && (
                <meta property="og:description" content={ogDescription} />
            )}
            <meta property="og:image" content={socialImage} />
            <meta property="og:image:width" content="400" />
            <meta property="og:image:height" content="400" />

            {/* Twitter */}
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={ogTitle || title} />
            {ogDescription && (
                <meta name="twitter:description" content={ogDescription} />
            )}
            <meta name="twitter:image" content={socialImage} />

            {/* Additional meta tags */}
            <meta
                name="viewport"
                content="width=device-width, initial-scale=1"
            />
            <meta charSet="utf-8" />
            <meta httpEquiv="X-UA-Compatible" content="ie=edge" />

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
