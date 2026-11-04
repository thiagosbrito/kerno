import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@kerno/contracts", "@kerno/server", "@kerno/ui"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The admin UI must never be framed (clickjacking on role and member changes).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};
export default config;
