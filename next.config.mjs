/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    GSO_VERSION: process.env.npm_package_version,
    GSO_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? 'dev'
  }
};

export default nextConfig;
