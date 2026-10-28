// services/entra.js: "Sign in with Microsoft 365" (Entra ID) using the OAuth code flow with PKCE.
// Staff sign in with the same Microsoft account they use for email. This site never sees their password.
import { ConfidentialClientApplication, CryptoProvider } from "@azure/msal-node";

const SCOPES = ["openid", "profile", "email"];

export function createEntra({ tenantId, clientId, clientSecret, redirectUri }) {
  const msal = new ConfidentialClientApplication({
    auth: { clientId, clientSecret, authority: `https://login.microsoftonline.com/${tenantId}` },
  });
  const crypto = new CryptoProvider();

  return {
    // Step 1: where to send the browser. Returns the Microsoft URL and the PKCE verifier to keep in the session.
    async start(state) {
      const { verifier, challenge } = await crypto.generatePkceCodes();
      const url = await msal.getAuthCodeUrl({
        scopes: SCOPES,
        redirectUri,
        state,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        prompt: "select_account",
      });
      return { url, verifier };
    },
    // Step 2: Microsoft sends the browser back with ?code=. Swap it for the signed-in person's details.
    async finish(code, verifier) {
      const r = await msal.acquireTokenByCode({ code, scopes: SCOPES, redirectUri, codeVerifier: verifier });
      const c = r?.idTokenClaims || {};
      return {
        email: String(c.preferred_username || c.email || "").toLowerCase(),
        tenantId: c.tid,
      };
    },
  };
}
