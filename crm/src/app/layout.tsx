import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Toaster } from "@/components/ui/form";
import { APP_NAME } from "@/lib/constants";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · Lead Command Center` },
  description: "CRM, lead tracking and sales pipeline for Hernandez Solutions LLC.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b1730" },
    { media: "(prefers-color-scheme: dark)", color: "#060a13" },
  ],
};

// Sets data-theme before first paint: saved choice, else the system setting.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("hs-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
