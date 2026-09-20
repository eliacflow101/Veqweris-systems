import type { Metadata } from "next";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { AuthProvider } from "@/lib/auth-context";
import { Shell } from "@/components/layout/shell";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Veqweris Systems",
  description: "Institutional operations platform",
  icons: { icon: "/branding/logo-icon.png" },
};

const themeScript = `(() => { const saved = localStorage.getItem('veqweris-theme'); document.documentElement.dataset.theme = saved === 'light' ? 'light' : 'dark'; })()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="dark" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body><ThemeProvider><AuthProvider><Shell>{children}</Shell></AuthProvider></ThemeProvider></body></html>;
}
