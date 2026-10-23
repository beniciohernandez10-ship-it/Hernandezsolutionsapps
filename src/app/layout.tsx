import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/sw-register";

export const metadata: Metadata = {
  title: { default: "Hernandez Solutions IT Center", template: "%s · Hernandez Solutions IT Center" },
  description: "Get IT support from Hernandez Solutions: submit requests, follow progress and talk with your technician.",
  applicationName: "Hernandez Solutions IT Center",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "IT Center", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0d" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers keeps every page dynamically rendered, which the per-request CSP nonce requires.
  await headers();
  // Settings → Appearance. Without a choice the portal follows the system.
  const theme = (await cookies()).get("itc-theme")?.value;
  return (
    <html lang="en" data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      <body>
        {children}
        <ServiceWorkerRegistration />
        <Analytics />
      </body>
    </html>
  );
}
