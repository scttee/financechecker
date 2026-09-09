import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// Inter carries the whole system rather than falling back to whatever the
// device happens to ship, so the app looks the same, deliberately chosen
// typeface everywhere rather than "mostly SF Pro on Apple hardware."
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Future Scotty',
  description: 'A calm financial cockpit.',
  // This app holds banking data. It should never be indexed by anything.
  robots: { index: false, follow: false, nocache: true },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/favicon-32.png', sizes: '32x32', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  // Lets "Add to Home Screen" open as its own standalone app rather than a
  // Safari tab with chrome around it.
  appleWebApp: {
    capable: true,
    title: 'Future Scotty',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom stays available. Locking it out to make an app feel native makes it
  // unusable for anyone who needs to make the text bigger.
  maximumScale: 5,
  // The content itself still respects the safe area (see the bottom nav's
  // env(safe-area-inset-bottom)); this just lets the background paint behind
  // the notch/home indicator instead of leaving a white/black bar there.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={inter.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
