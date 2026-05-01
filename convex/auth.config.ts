import type { AuthConfig } from "convex/server";

const issuer = "http://localhost:3000";
const audience = "odogwu-hq";

export default {
  providers: [
    {
      type: "customJwt",
      issuer,
      jwks: `${issuer}/.well-known/jwks.json`,
      applicationID: audience,
      algorithm: "RS256",
    },
  ],
} satisfies AuthConfig;
