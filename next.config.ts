import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  webpack(config, { webpack }) {
    if (process.env.CRM_RUNTIME === "miran") {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(
        /^cloudflare:workers$/, resolve(process.cwd(), "server/cloudflare.ts"),
      ));
    }
    return config;
  },
};

export default nextConfig;
