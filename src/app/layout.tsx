import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// One family, loaded once. A POS is read at arm's length on a cheap screen in
// variable light; a single high-legibility face with tabular figures beats a
// display/body pairing here.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "AI-POS",
    template: "%s · AI-POS",
  },
  description:
    "AI-powered point of sale for African SMEs — sales, inventory, M-Pesa and business intelligence.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="bg-surface text-ink flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
