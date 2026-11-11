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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="antialiased"><CrmThemeProvider>{children}</CrmThemeProvider></body>
    </html>
  );
}
