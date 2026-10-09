import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/sw-register";

export const metadata: Metadata = {
  title: { default: "Hernandez Solutions IT Center", template: "%s · Hernandez Solutions IT Center" },
  description: "Get IT support from Hernandez Solutions: submit requests, follow progress and talk with your technician.",
  applicationName: "Hernandez Solutions IT Center",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
  appleWebApp: { capable: true, title: "IT Center", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#05060a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers keeps every page dynamically rendered, which the per-request CSP nonce requires.
  await headers();
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
