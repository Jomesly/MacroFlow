import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let isolated Auth integration tests run beside the developer's app.
  distDir: process.env.MACROFLOW_AUTH_TEST_MODE === 'true' ? '.next-auth-tests' : '.next',
  logging: {
    // Confirmation URLs contain one-time secrets; form arguments may contain passwords.
    incomingRequests: { ignore: [/\/auth\/confirm(?:\?|$)/] },
    serverFunctions: false,
  },
};

export default nextConfig;
