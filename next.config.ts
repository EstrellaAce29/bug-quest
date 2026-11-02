import type { NextConfig } from "next";

const config: NextConfig = {
  async redirects() {
    return [
      { source: "/arena", destination: "/play", permanent: true },
      { source: "/api/arena", destination: "/api/play", permanent: true },
    ];
  },
};

export default config;
