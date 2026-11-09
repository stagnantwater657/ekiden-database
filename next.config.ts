import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: { cpus: process.env.EKIDEN_BUILD_CPUS === "1" ? 1 : 2 },
};
export default config;
