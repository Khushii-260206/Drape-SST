import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/AppProviders";
import AppShell from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { RegisterSW } from "@/components/RegisterSW";
import { SUPABASE_URL } from "@/lib/env";
import { THEME_SCRIPT } from "@/lib/theme-script";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Drape — your AI stylist", template: "%s · Drape" },
  description:
    "Photograph your clothes once. Drape learns your wardrobe and styles outfits for any occasion — and tells you what's worth buying next.",
  applicationName: "Drape",
  appleWebApp: { capable: true, title: "Drape", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff9f2" },
    { media: "(prefers-color-scheme: dark)", color: "#1d1b20" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${instrument.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint so dark mode never flashes white. A constant string we wrote. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* Open the connection to the database and photo storage while the page's scripts are still loading. */}
        {SUPABASE_URL && <link rel="preconnect" href={SUPABASE_URL} crossOrigin="" />}
        {SUPABASE_URL && <link rel="dns-prefetch" href={SUPABASE_URL} />}
      </head>
      <body className="min-h-dvh font-sans text-gray-900 antialiased">
        <AuthGate>
          <AppProviders>
            <AppShell>{children}</AppShell>
          </AppProviders>
        </AuthGate>
        <RegisterSW />
      </body>
    </html>
  );
}
