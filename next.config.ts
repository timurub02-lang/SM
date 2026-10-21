import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers(){return [{source:'/oktell-demo',headers:[{key:'Content-Security-Policy',value:"default-src 'self'; connect-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'"},{key:'Permissions-Policy',value:'microphone=(), camera=()'},{key:'Cache-Control',value:'no-store'}]}];},
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
