import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Brash3D · Compras en vivo",
  description: "Reserva y sigue tu sesión de compra en vivo desde el outlet con Brash3D.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      // Browser translation rewrites text nodes in place. React still holds the
      // nodes it rendered, so the next re-render throws NotFoundError from
      // removeChild and the error boundary replaces the page - after the action
      // that triggered the re-render has already been committed, which makes a
      // successful write look like a failure. The staff panels are English
      // inside a page declared Spanish, which is exactly what prompts Chrome to
      // offer the translation, so the app opts out rather than relying on every
      // operator turning it off.
      translate="no"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased notranslate`}
    >
      <head>
        <meta name="google" content="notranslate" />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem storageKey="brash3d-theme" disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
