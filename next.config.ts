import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolate builds and Auth integration tests from the running developer app.
  distDir: process.env.MACROFLOW_BUILD_DIR || (process.env.MACROFLOW_AUTH_TEST_MODE === 'true' ? '.next-auth-tests' : '.next'),
  logging: {
    // Confirmation URLs contain one-time secrets; form arguments may contain passwords.
    incomingRequests: { ignore: [/\/auth\/confirm(?:\?|$)/] },
    serverFunctions: false,
  },
};

export default nextConfig;
