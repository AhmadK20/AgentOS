import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './workspace.css';

export const metadata: Metadata = {
  title: 'AgentOS — Your agents, together.',
  description: 'One workspace for your Hermes agents. Chat, delegate, and follow every step.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
