import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/locale";
import { LocaleProvider } from "@/lib/i18n/provider";
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Read on the server so the first paint is already in the reader's language.
  // Resolving client-side would show Spanish and then swap, and would leave
  // `lang` wrong for a screen reader on the initial render.
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value)

  return (
    <html
      lang={locale}
      // Browser translation rewrites text nodes in place. React still holds the
      // nodes it rendered, so the next re-render throws NotFoundError from
      // removeChild and the error boundary replaces the page - after the action
      // that triggered the re-render has already been committed, which makes a
      // successful write look like a failure. This is why the app ships its own
      // Spanish/English switcher (LanguageToggle) instead: the translation
      // happens in React's own render, so the DOM stays React's to manage.
      translate="no"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased notranslate`}
    >
      <head>
        <meta name="google" content="notranslate" />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem storageKey="brash3d-theme" disableTransitionOnChange>
          <LocaleProvider initialLocale={locale}>
            {children}
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
