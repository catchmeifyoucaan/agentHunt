import Head from 'next/head';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string[];
  image?: string;
  url?: string;
  type?: 'website' | 'article';
  noindex?: boolean;
}

export function SEO({
  title = 'AgentHunt - AI-Powered Security Orchestration Platform',
  description = 'Advanced security orchestration platform with 17+ specialized AI agents for reconnaissance, scanning, exploitation, and analysis. Features OpenTelemetry observability, multi-agent coordination, and certificate transparency monitoring.',
  keywords = [
    'bug bounty',
    'security automation',
    'penetration testing',
    'vulnerability scanning',
    'AI security',
    'security orchestration',
    'reconnaissance',
    'OpenTelemetry',
    'multi-agent system',
    'certificate transparency',
    'vulnerability assessment',
    'security testing',
  ],
  image = '/og-image.png',
  url = 'https://agenthunt.io',
  type = 'website',
  noindex = false,
}: SEOProps) {
  const fullTitle = title.includes('AgentHunt') ? title : `${title} | AgentHunt`;

  return (
    <Head>
      {/* Basic Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords.join(', ')} />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta charSet="utf-8" />

      {/* Robots */}
      {noindex && <meta name="robots" content="noindex,nofollow" />}

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:url" content={url} />
      <meta property="og:site_name" content="AgentHunt" />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {/* Favicon */}
      <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
      <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />

      {/* Canonical */}
      <link rel="canonical" href={url} />

      {/* PWA */}
      <meta name="theme-color" content="#7c3aed" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    </Head>
  );
}
