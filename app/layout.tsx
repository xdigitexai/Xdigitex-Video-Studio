import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LanguageRuntime } from "@/components/language-runtime";

export const metadata: Metadata = {
  title: {
    default: "Malaba AI Studio — Create. Edit. Inspire.",
    template: "%s · Malaba AI Studio",
  },
  description:
    "Generate cinematic AI video and images, edit them in one workspace, and export with confidence. Create. Edit. Inspire.",
  icons: {
    icon: ["/favicon.png", "/favicon.ico"],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  applicationName: "Malaba AI Studio",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080B2E",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body><LanguageRuntime>{children}</LanguageRuntime></body>
    </html>
  );
}
