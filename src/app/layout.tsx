import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Odogwu HQ",
  description: "Private console for replies that sound like you, follow-ups, and chat automation you control.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
