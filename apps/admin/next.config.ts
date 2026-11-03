import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@kerno/contracts", "@kerno/server", "@kerno/ui"],
  poweredByHeader: false,
};
export default config;
