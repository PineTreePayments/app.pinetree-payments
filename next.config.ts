import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/woocommerce/plugin/download': ['./artifacts/woocommerce/*.zip'],
  },
  async rewrites() {
    return [
      {
        source: '/api/coingecko/:path*',
        destination: 'https://api.coingecko.com/api/v3/:path*',
      },
    ]
  }
};

export default nextConfig;
