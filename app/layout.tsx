import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "VideoX by Xdigitex — AI video & image generation",
    template: "%s · VideoX",
  },
  description:
    "Generate cinematic AI video and images with Runway, OpenAI, Gemini, Kling and more. Edit, caption, price and publish from one premium studio.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  applicationName: "VideoX",
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
