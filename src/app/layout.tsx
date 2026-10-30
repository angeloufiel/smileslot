import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { getBranding } from "@/lib/data/branding";

// Self-hosted variable fonts (SIL Open Font License, see src/fonts): no request to Google at build or run time.
const figtree = localFont({ src: "../fonts/figtree-latin-wght-normal.woff2", variable: "--font-figtree", weight: "300 900", display: "swap" });
const bricolage = localFont({ src: "../fonts/bricolage-grotesque-latin-wght-normal.woff2", variable: "--font-bricolage", weight: "200 800", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const { name } = await getBranding();
  return {
    title: { default: `${name}: book an appointment`, template: `%s | ${name}` },
    description: "See real open times and book your dental appointment online in under a minute.",
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} ${bricolage.variable} h-full`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
