import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';

export const metadata: Metadata = {
  title: {
    default: 'AgentHunt - AI-Powered Security Orchestration Platform',
    template: '%s | AgentHunt',
  },
  description: 'Advanced security orchestration platform with 17+ specialized AI agents for reconnaissance, scanning, exploitation, and analysis. Features OpenTelemetry observability, multi-agent coordination, and certificate transparency monitoring.',
  keywords: [
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
    'ReACT pattern',
    'graph of agents',
  ],
  authors: [{ name: 'AgentHunt Team' }],
  creator: 'AgentHunt',
  publisher: 'AgentHunt',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL('https://agenthunt.io'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://agenthunt.io',
    title: 'AgentHunt - AI-Powered Security Orchestration Platform',
    description: 'Advanced security orchestration platform with 17+ specialized AI agents for reconnaissance, scanning, exploitation, and analysis.',
    siteName: 'AgentHunt',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'AgentHunt Platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AgentHunt - AI-Powered Security Orchestration Platform',
    description: 'Advanced security orchestration platform with 17+ specialized AI agents.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
              <Header />
              <main className="flex-1 overflow-auto bg-background">
                {children}
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
