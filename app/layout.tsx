import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "PineTree Payments",
    template: "%s | PineTree Payments",
  },
  description:
    "Crypto-enabled merchant POS platform for modern businesses. Accept digital assets seamlessly in-store and online.",

  metadataBase: new URL("https://pinetree-payments.com"), // change if needed

  

  openGraph: {
    title: "PineTree Payments",
    description:
      "Crypto-enabled merchant POS platform for modern businesses.",
    url: "https://pinetree-payments.com", // change if needed
    siteName: "PineTree Payments",
    images: [
      {
        url: "/pinetree-preview.png",
        width: 1200,
        height: 630,
        alt: "PineTree Payments Logo",
      },
    ],
    locale: "en_US",
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "PineTree Payments",
    description:
      "Crypto-enabled merchant POS platform for modern businesses.",
    images: ["/pinetree-preview.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
