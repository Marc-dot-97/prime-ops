// app.js: builds the Express app. index.js starts it; the tests build it with a stub sign-in.
import express from "express";
import session from "express-session";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  getDashboardData,
  getToken,
  oauthConfigured,
  buildAuthorizeUrl,
  newState,
  exchangeCode,
  ClickUpAuthError,
} from "./services/clickup.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const view = (name) => fs.readFileSync(path.join(here, "views", name), "utf8");

export function createApp({ entra, tenantId, sessionSecret, isProduction = false }) {
  const app = express();
  if (isProduction) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" });
    next();
  });

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: "lax", secure: isProduction },
    })
  );

  const ensureAuth = (req, res, next) => {
    if (req.session?.user) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "signed_out" });
    res.redirect("/login");
  };

  // Optional: limit who may connect ClickUp. OPS_ADMIN_EMAILS=a@x.com,b@x.com (empty = any signed-in user)
  const isAdmin = (req) => {
    const list = (process.env.OPS_ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return !list.length || list.includes(String(req.session?.user?.email || "").toLowerCase());
  };

  // Public static files (CSS, JS, favicon) hold no data. The data only comes from /api/ops/tasks.
  app.use(express.static(path.join(here, "public"), { index: false }));

  // ---------- sign in with Microsoft 365 ----------
  // Who may enter: must be in OUR Microsoft tenant, and (optionally) on an allowed email domain / email list.
  const allowed = (email) => {
    const domains = (process.env.OPS_ALLOWED_DOMAIN || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const emails = (process.env.OPS_ALLOWED_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!email) return false;
    if (emails.includes(email)) return true;
    if (domains.length) return domains.includes(email.split("@")[1]);
    return !emails.length; // nothing configured = anyone in the tenant
  };
  const ERRORS = {
    failed: "Microsoft sign-in did not complete. Please try again.",
    noaccess: "Your Microsoft account is not allowed to use this dashboard. Please contact IT Support.",
  };

  app.get("/login", (req, res) => {
    if (req.session?.user) return res.redirect("/");
    const msg = req.query.error ? ERRORS[req.query.error] || ERRORS.failed : "";
    res.type("html").send(view("login.html").replace("__ERROR__", msg));
  });

  app.get("/auth/microsoft", async (req, res, next) => {
    try {
      const state = crypto.randomBytes(16).toString("hex");
      const { url, verifier } = await entra.start(state);
      req.session.msState = state;
      req.session.msVerifier = verifier;
      req.session.save(() => res.redirect(url));
    } catch (e) {
      next(e);
    }
  });

  app.get("/auth/callback", async (req, res) => {
    const { code, state } = req.query;
    const { msState, msVerifier } = req.session || {};
    if (!code || !state || !msState || state !== msState) return res.redirect("/login?error=failed");
    try {
      const who = await entra.finish(String(code), msVerifier);
      if (tenantId && who.tenantId !== tenantId) return res.redirect("/login?error=noaccess");
      if (!allowed(who.email)) return res.redirect("/login?error=noaccess");
      req.session.regenerate((err) => {
        if (err) return res.redirect("/login?error=failed");
        req.session.user = { email: who.email };
        res.redirect("/");
      });
    } catch (e) {
      console.error("Microsoft sign-in failed:", e.message);
      res.redirect("/login?error=failed");
    }
  });
  app.get("/logout", (req, res) => req.session.destroy(() => res.redirect("/login")));

  // ---------- dashboard ----------
  app.get(["/", "/ops"], ensureAuth, async (req, res) => {
    const { source } = await getToken();
    const cfg = {
      refreshSeconds: Number(process.env.OPS_REFRESH_SECONDS) || 300,
      connected: Boolean(source),
    };
    res.type("html").send(view("dashboard.html").replace("__OPS_CONFIG__", JSON.stringify(cfg)));
  });

  app.get("/api/ops/tasks", ensureAuth, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json(await getDashboardData({ force: req.query.refresh === "1" }));
    } catch (err) {
      if (err instanceof ClickUpAuthError) {
        return res.status(err.notConnected ? 409 : 502).json({
          error: err.notConnected ? "not_connected" : "token_rejected",
          message: err.notConnected
            ? "ClickUp is not connected yet."
            : "ClickUp rejected the saved access token. Please reconnect.",
          canConnect: oauthConfigured() && isAdmin(req),
        });
      }
      console.error("ClickUp feed failed:", err.message);
      res.status(502).json({ error: "upstream", message: "ClickUp could not be reached. Please try again shortly." });
    }
  });

  // ---------- connect ClickUp (OAuth: https://developer.clickup.com/reference/getaccesstoken) ----------
  app.get("/ops/clickup/connect", ensureAuth, (req, res) => {
    if (!oauthConfigured() || !isAdmin(req)) return res.status(403).send("Not available.");
    req.session.clickupState = newState();
    res.redirect(buildAuthorizeUrl(req.session.clickupState));
  });
  app.get("/ops/clickup/callback", ensureAuth, async (req, res) => {
    const { code, state } = req.query;
    if (!isAdmin(req) || !code || !state || state !== req.session.clickupState) {
      return res.status(400).send("The ClickUp sign-in could not be verified. Please start again from the dashboard.");
    }
    delete req.session.clickupState;
    try {
      await exchangeCode(String(code));
      res.redirect("/");
    } catch (err) {
      console.error("ClickUp token exchange failed:", err.message);
      res.status(502).send("ClickUp did not accept the sign-in. Please try again.");
    }
  });

  app.use((err, req, res, next) => {
    console.error(err.message);
    res.status(500).send("Something went wrong.");
  });
  return app;
}
