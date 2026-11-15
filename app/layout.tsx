import {headers} from 'next/headers';
import {impersonationStatus} from '@/lib/auth';
import {ImpersonationSession} from '@/components/impersonation-session';
import type { Metadata } from "next";
import "./globals.css";
import "./macos.css";
import "./dark.css";
import { CrmThemeProvider } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "СМ · Клиенты и заказы",
  description: "CRM для заботы о каждом клиенте и контроля каждого заказа.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const mode=await impersonationStatus(new Headers(await headers()));
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="antialiased"><CrmThemeProvider><ImpersonationSession mode={mode}>{children}</ImpersonationSession></CrmThemeProvider></body>
    </html>
  );
}
