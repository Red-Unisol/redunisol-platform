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
  children,
}: SeoHeadProps) {
  const appName = 'RedúniSol';
  const fullTitle = title.includes(appName) ? title : `${title} | ${appName}`;

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
      {ogDescription && <meta property="og:description" content={ogDescription} />}
      {ogImage && <meta property="og:image" content={ogImage} />}

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={ogTitle || title} />
      {ogDescription && <meta name="twitter:description" content={ogDescription} />}
      {ogImage && <meta name="twitter:image" content={ogImage} />}

      {/* Additional meta tags */}
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta charSet="utf-8" />
      <meta httpEquiv="X-UA-Compatible" content="ie=edge" />

      {children}
    </Head>
  );
}
