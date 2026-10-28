// test/smoke.test.js: runs the real app against a fake ClickUp server (no real token, no database).
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs";

const fixture = JSON.parse(fs.readFileSync(new URL("./clickup-fixture.json", import.meta.url), "utf8"));
const seen = [];
const fake = http.createServer((req, res) => {
  seen.push({ url: req.url, auth: req.headers.authorization });
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/v2/oauth/token") {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ access_token: "oauth-test-token" }));
  }
  if (u.pathname.endsWith("/list")) return res.end(JSON.stringify({ lists: [{ name: "Empty Project List" }] }));
  if (u.pathname.endsWith("/folder")) return res.end(JSON.stringify({ folders: [{ lists: [{ name: "Leads dashboard for tracking and reporting" }] }] }));
  if (req.headers.authorization !== "pk_test") { res.statusCode = 401; return res.end("{}"); }
  const page = Number(u.searchParams.get("page") || 0);
  const tasks = fixture.slice(page * 100, page * 100 + 100);
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ tasks, last_page: (page + 1) * 100 >= fixture.length }));
});
await new Promise((r) => fake.listen(0, r));
process.env.CLICKUP_API_BASE = `http://127.0.0.1:${fake.address().port}/api/v2`;
process.env.CLICKUP_TOKEN_FILE = "data/test-token.json";
process.env.CLICKUP_CLIENT_ID = "cid"; process.env.CLICKUP_CLIENT_SECRET = "sec"; process.env.CLICKUP_REDIRECT_URI = "http://localhost/cb";

const { createApp } = await import("../app.js");
let nextWho = { email: "staff@optimumgroup.co.za", tenantId: "tenant-1" };
process.env.OPS_ALLOWED_DOMAIN = "optimumgroup.co.za";
const entra = {
  start: async (state) => ({ url: `https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize?state=${state}`, verifier: "v" }),
  finish: async (code, verifier) => { assert.equal(verifier, "v"); if (code === "boom") throw new Error("bad code"); return nextWho; },
};
const app = createApp({ entra, tenantId: "tenant-1", sessionSecret: "test" });
const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
let cookie = "";
const call = async (p, o = {}) => {
  const r = await fetch(base + p, { redirect: "manual", ...o, headers: { cookie, ...(o.headers || {}) } });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  return r;
};

// signed out
assert.equal((await call("/api/ops/tasks")).status, 401);
assert.equal((await call("/")).status, 302);
// Microsoft sign-in: state is checked, tenant + domain are enforced
let r = await call("/auth/microsoft"); assert.equal(r.status, 302);
const state = new URL(r.headers.get("location")).searchParams.get("state");
assert.equal((await call("/auth/callback?code=c&state=wrong")).headers.get("location"), "/login?error=failed");
assert.equal((await call("/auth/callback?code=boom&state=" + state)).headers.get("location"), "/login?error=failed");
nextWho = { email: "x@gmail.com", tenantId: "tenant-1" };
assert.equal((await call("/auth/callback?code=c&state=" + state)).headers.get("location"), "/login?error=noaccess");
nextWho = { email: "staff@optimumgroup.co.za", tenantId: "other-tenant" };
assert.equal((await call("/auth/callback?code=c&state=" + state)).headers.get("location"), "/login?error=noaccess");
nextWho = { email: "staff@optimumgroup.co.za", tenantId: "tenant-1" };
assert.equal((await call("/auth/callback?code=c&state=" + state)).headers.get("location"), "/");
// not connected yet
r = await call("/api/ops/tasks"); assert.equal(r.status, 409); assert.equal((await r.json()).error, "not_connected");
// connected with a token
process.env.CLICKUP_API_TOKEN = "pk_test";
r = await call("/api/ops/tasks"); assert.equal(r.status, 200);
const d = await r.json();
assert.equal(d.tasks.length, fixture.length, "all pages fetched");
const text = JSON.stringify(d);
assert.ok(!/"id"|person@example\.invalid|1001|1002/.test(text), "no ClickUp user ids or emails reach the browser");
assert.ok(Array.isArray(d.members) && d.members.length >= 3, "assignees come through as display names");
assert.ok(d.members.includes("Jordan"), "first name is shown, e.g. Jordan");
assert.ok(d.tasks.some((t) => t.as.length && t.as.every((i) => typeof d.members[i] === "string")), "tickets point at those names");
assert.ok(d.tasks.every((t) => ["to do", "in progress", "blocked", "complete"].includes(t.st)));
assert.ok(d.allLists.includes("Empty Project List") && d.allLists.includes("Leads Dashboard"), "empty project lists are reported");
assert.ok(seen.every((s) => s.auth === "pk_test" || s.url.includes("oauth")), "token sent as Authorization header");
assert.ok(seen.some((s) => s.url.includes("space_ids%5B%5D=901511610772") && s.url.includes("include_closed=true")));
const before = seen.length; await call("/api/ops/tasks"); assert.equal(seen.length, before, "second call served from cache");
// token rejected
process.env.CLICKUP_API_TOKEN = "bad"; const { invalidate } = await import("../services/clickup.js"); invalidate();
r = await call("/api/ops/tasks"); assert.equal(r.status, 502); assert.equal((await r.json()).error, "token_rejected");
// dashboard html + oauth state check
process.env.CLICKUP_API_TOKEN = "pk_test";
r = await call("/"); assert.equal(r.status, 200); assert.ok((await r.text()).includes('"refreshSeconds":300'));
r = await call("/ops/clickup/connect"); assert.equal(r.status, 302); assert.ok(r.headers.get("location").startsWith("https://app.clickup.com/api?client_id=cid"));
assert.equal((await call("/ops/clickup/callback?code=x&state=wrong")).status, 400);
console.log("ALL SMOKE TESTS PASSED");
srv.close(); fake.close(); fs.rmSync("data/test-token.json", { force: true });
