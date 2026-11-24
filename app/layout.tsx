import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LanguageRuntime } from "@/components/language-runtime";

export const metadata: Metadata = {
  title: {
    default: "Malaba Video AI — AI video & image generation",
    template: "%s · Malaba Video AI",
  },
  description:
    "Generate cinematic AI video and images with Runway, OpenAI, Gemini, Kling and more. Edit, caption, price and publish from one premium studio.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  applicationName: "Malaba Video AI",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07090c",
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
