import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers(){return [
    {source:'/:path*',headers:[
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'Referrer-Policy',value:'same-origin'},
      {key:'Content-Security-Policy',value:"object-src 'none'; base-uri 'self'; frame-ancestors 'self'"},
    ]},
    {source:'/(oktell|oktell-demo|oktell-projects|oktell-test)',headers:[{key:'Content-Security-Policy',value:"default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"},{key:'Permissions-Policy',value:'microphone=(), camera=()'},{key:'Cache-Control',value:'no-store'}]},
  ];},
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
