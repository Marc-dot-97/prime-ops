// index.js: starts the PrimeBridge Ops dashboard.
import env from "dotenv";
env.config();

const { createApp } = await import("./app.js");
const { createEntra } = await import("./services/entra.js");

const need = ["SESSION_SECRET", "ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ENTRA_REDIRECT_URI"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(", ")} (see .env.example)`);
  process.exit(1);
}
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT) || 3100;

const entra = createEntra({
  tenantId: process.env.ENTRA_TENANT_ID,
  clientId: process.env.ENTRA_CLIENT_ID,
  clientSecret: process.env.ENTRA_CLIENT_SECRET,
  redirectUri: process.env.ENTRA_REDIRECT_URI,
});

createApp({ entra, tenantId: process.env.ENTRA_TENANT_ID, sessionSecret: process.env.SESSION_SECRET, isProduction }).listen(
  port,
  () => console.log(`PrimeBridge Ops running on http://localhost:${port}`)
);
