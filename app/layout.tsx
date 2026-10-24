import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Bug Quest · Pipeline Monitor', description: 'A focused monitor for enrollment_pipeline.' };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
