import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Don't bundle workerd and miniflare on the server side
    // This allows them to properly access their optional dependencies
    config.externals = config.externals || [];
    config.externals.push({
      'workerd': 'commonjs workerd',
      'miniflare': 'commonjs miniflare',
      '@cloudflare/workerd-darwin-arm64': 'commonjs @cloudflare/workerd-darwin-arm64',
      '@cloudflare/workerd-darwin-64': 'commonjs @cloudflare/workerd-darwin-64',
      '@cloudflare/workerd-linux-arm64': 'commonjs @cloudflare/workerd-linux-arm64',
      '@cloudflare/workerd-linux-64': 'commonjs @cloudflare/workerd-linux-64',
      '@cloudflare/workerd-windows-64': 'commonjs @cloudflare/workerd-windows-64',
    });
    return config;
  },
};

export default nextConfig;
