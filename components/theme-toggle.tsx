"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { Moon } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export function CrmThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeProvider attribute="class" storageKey="crm-theme" defaultTheme="light" enableSystem={false} disableTransitionOnChange>{children}</ThemeProvider>;
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <label className="sidebar-settings-toggle theme-toggle">
    <span><Moon size={16} aria-hidden="true"/>Тёмная тема</span>
    <Switch aria-label="Тёмная тема" disabled={!mounted} checked={mounted && theme === "dark"} onCheckedChange={dark => setTheme(dark ? "dark" : "light")}/>
  </label>;
}
