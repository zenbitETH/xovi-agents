/** @type {import('next').NextConfig} */
const nextConfig = {
  // No middleware.ts anywhere in this project, deliberately. The paid route
  // states its own gate; a path matcher would state it somewhere else and drift.
  reactStrictMode: true,
};
export default nextConfig;
