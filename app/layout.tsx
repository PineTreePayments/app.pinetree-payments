import type { Metadata } from "next";
import "./globals.css";
import { Web3Provider } from "@/components/providers/Web3Provider"
import { SolanaProvider } from "@/components/providers/SolanaProvider"

export const metadata: Metadata = {
  title: {
    default: "PineTree Payments",
    template: "%s | PineTree Payments",
  },
  description:
    "Crypto-enabled merchant POS platform for modern businesses. Accept digital assets seamlessly in-store and online.",

  metadataBase: new URL("https://pos.pinetree-payments.com"),

  openGraph: {
    title: "PineTree Payments",
    description:
      "Crypto-enabled merchant POS platform for modern businesses.",
    url: "https://pos.pinetree-payments.com",
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
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/png" href="/favicon.png" />
      </head>
      <body className="font-sans antialiased">
        <SolanaProvider>
          <Web3Provider>
            {children}
          </Web3Provider>
        </SolanaProvider>
      </body>
    </html>
  );
}