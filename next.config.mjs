/** @type {import('next').NextConfig} */
const nextConfig = {
  // No middleware.ts anywhere in this project, deliberately. The paid route
  // states its own gate; a path matcher would state it somewhere else and drift.
  reactStrictMode: true,

  // The snapshot is read through a path assembled at runtime from an environment
  // variable, so the file tracer has nothing to follow and does not ship it. The
  // route then answers 503 on every request, which is the correct behaviour for a
  // missing snapshot and the wrong diagnosis entirely: nothing is misconfigured,
  // the file simply is not there.
  //
  // Top level rather than under experimental. Checked against the installed
  // version's own config types, where it sits in NextConfig beside
  // outputFileTracingExcludes and not inside the experimental property.
  outputFileTracingIncludes: {
    "/api/agent/windows": ["./fixtures/**"],
  },
};
export default nextConfig;
