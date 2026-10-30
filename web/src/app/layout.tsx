import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { Shell } from "@/components/Shell";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Paytm Business · Saathi",
  description: "Merchant dashboard for the Paytm Saathi hackathon prototype (sample data).",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} antialiased`}>
      <body className="min-h-screen">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
