import type { NextConfig } from "next";
import path from "node:path";

process.env.NEXT_TELEMETRY_DISABLED = "1";

const backend = process.env.MARKER_BACKEND ?? "http://127.0.0.1:8765";
const shared: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: { root: path.resolve(__dirname) },
};

// Development proxies to the Python server. The build is a static site that server.py serves itself.
const config: NextConfig =
  process.env.NODE_ENV === "production"
    ? { ...shared, output: "export" }
    : {
        ...shared,
        rewrites: async () => [
          { source: "/api/:path*", destination: `${backend}/api/:path*` },
          { source: "/pdf", destination: `${backend}/pdf` },
        ],
      };

export default config;
