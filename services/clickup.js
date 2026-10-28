// services/clickup.js: talks to the ClickUp REST API (v2) from the SERVER only.
// The token never reaches the browser. ClickUp user IDs and emails are also stripped here: the browser only
// receives each assignee's display name.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const cfg = () => ({
  base: (process.env.CLICKUP_API_BASE || "https://api.clickup.com/api/v2").replace(/\/+$/, ""),
  team: process.env.CLICKUP_TEAM_ID || "90152653226",
  space: process.env.CLICKUP_SPACE_ID || "901511610772",
  tokenFile: path.resolve(process.env.CLICKUP_TOKEN_FILE || "data/clickup-token.json"),
  ttl: (Number(process.env.CLICKUP_CACHE_SECONDS) || 60) * 1000,
});

export class ClickUpAuthError extends Error {}

// ---------- token ----------
export async function getToken() {
  if (process.env.CLICKUP_API_TOKEN) return { token: process.env.CLICKUP_API_TOKEN, source: "env" };
  try {
    const saved = JSON.parse(await fs.readFile(cfg().tokenFile, "utf8"));
    if (saved?.access_token) return { token: saved.access_token, source: "oauth" };
  } catch {
    /* no saved token yet */
  }
  return { token: null, source: null };
}

export const oauthConfigured = () =>
  Boolean(process.env.CLICKUP_CLIENT_ID && process.env.CLICKUP_CLIENT_SECRET && process.env.CLICKUP_REDIRECT_URI);

export function buildAuthorizeUrl(state) {
  const q = new URLSearchParams({
    client_id: process.env.CLICKUP_CLIENT_ID,
    redirect_uri: process.env.CLICKUP_REDIRECT_URI,
    state,
  });
  return `https://app.clickup.com/api?${q}`;
}

export const newState = () => crypto.randomBytes(16).toString("hex");

// https://developer.clickup.com/reference/getaccesstoken : exchange the ?code= for an access token
export async function exchangeCode(code) {
  const { base, tokenFile } = cfg();
  const res = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.CLICKUP_CLIENT_ID,
      client_secret: process.env.CLICKUP_CLIENT_SECRET,
      code,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`ClickUp did not return a token (HTTP ${res.status}).`);
  await fs.mkdir(path.dirname(tokenFile), { recursive: true });
  await fs.writeFile(
    tokenFile,
    JSON.stringify({ access_token: body.access_token, saved_utc: new Date().toISOString() }),
    { mode: 0o600 }
  );
  invalidate();
}

// ---------- fetching ----------
async function api(url, token, attempt = 0) {
  const res = await fetch(url, { headers: { Authorization: token, "Content-Type": "application/json" } });
  if (res.status === 401 || res.status === 403) throw new ClickUpAuthError("ClickUp rejected the access token.");
  if (res.status === 429 && attempt < 2) {
    const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 10) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return api(url, token, attempt + 1);
  }
  if (!res.ok) throw new Error(`ClickUp API error (HTTP ${res.status}).`);
  return res.json();
}

async function fetchRawTasks(token) {
  const { base, team, space } = cfg();
  const all = [];
  for (let page = 0; page < 50; page++) {
    const q = `space_ids%5B%5D=${encodeURIComponent(space)}&include_closed=true&subtasks=true&page=${page}`;
    const data = await api(`${base}/team/${encodeURIComponent(team)}/task?${q}`, token);
    const tasks = data.tasks || [];
    all.push(...tasks);
    if (data.last_page === true || tasks.length === 0) break;
    if (data.last_page === undefined && tasks.length < 100) break;
  }
  return all;
}

// Every project list in the space (folderless lists + lists inside folders), so lists with no tickets still show up.
async function fetchListNames(token) {
  const { base, space } = cfg();
  const names = [];
  try {
    const loose = await api(`${base}/space/${encodeURIComponent(space)}/list?archived=false`, token);
    for (const l of loose.lists || []) names.push(l.name);
    const folders = await api(`${base}/space/${encodeURIComponent(space)}/folder?archived=false`, token);
    for (const f of folders.folders || []) for (const l of f.lists || []) names.push(l.name);
  } catch (err) {
    if (err instanceof ClickUpAuthError) throw err;
    /* the lists call is a nice-to-have: carry on with the lists found on tickets */
  }
  return names.map((n) => LIST_SHORT[n] || n);
}

// ---------- shaping: normalise + anonymise ----------
const LIST_SHORT = {
  "Leads dashboard for tracking and reporting": "Leads Dashboard",
  "Spoor (tracking / comparison)": "Spoor",
  "Wix Webiste": "Wix Website",
};

export function normaliseStatus(s) {
  const name = String(s?.status ?? s ?? "").toLowerCase().trim();
  const type = String(s?.type ?? "").toLowerCase();
  if (["complete", "completed", "done", "closed"].includes(name) || type === "closed" || type === "done") return "complete";
  if (name === "blocked") return "blocked";
  if (["to do", "not started", "open", "backlog"].includes(name) || type === "open") return "to do";
  return "in progress";
}

// Shapes ClickUp's raw tasks for the browser. Assignees are shown by the name they have in ClickUp (first name,
// or the full name when two people share a first name). ClickUp user IDs and emails are never sent.
export function shape(rawTasks) {
  const people = new Map(); // ClickUp user id -> { username, count }
  for (const t of rawTasks)
    for (const a of t.assignees || []) {
      const p = people.get(a.id) || { username: String(a.username || "Unknown").trim(), count: 0 };
      p.count++;
      people.set(a.id, p);
    }
  const ranked = [...people.entries()].sort((x, y) => y[1].count - x[1].count);
  const firsts = ranked.map(([, p]) => p.username.split(/\s+/)[0]);
  const names = ranked.map(([, p], i) => (firsts.filter((f) => f === firsts[i]).length > 1 ? p.username : firsts[i]));
  const order = new Map(ranked.map(([id], i) => [id, i]));
  const num = (v) => (v ? Number(v) : 0);
  const safeUrl = (u) => (typeof u === "string" && u.startsWith("https://app.clickup.com/") ? u : "");
  const tasks = rawTasks.map((t) => ({
    name: String(t.name ?? ""),
    st: normaliseStatus(t.status),
    pr: String(t.priority?.priority ?? t.priority ?? "none").toLowerCase(),
    as: (t.assignees || []).map((a) => order.get(a.id)),
    due: num(t.due_date),
    upd: num(t.date_updated),
    cl: num(t.date_closed),
    list: LIST_SHORT[t.list?.name] || t.list?.name || "No list",
    url: safeUrl(t.url),
  }));
  return { tasks, members: names };
}

// ---------- cache ----------
let cache = null; // { at, payload }
let inflight = null;
export function invalidate() {
  cache = null;
}

export async function getDashboardData({ force = false } = {}) {
  const { ttl } = cfg();
  if (cache && Date.now() - cache.at < (force ? 15_000 : ttl)) return { ...cache.payload, stale: false };
  if (inflight) return inflight;

  inflight = (async () => {
    const { token } = await getToken();
    if (!token) {
      const e = new ClickUpAuthError("ClickUp is not connected yet.");
      e.notConnected = true;
      throw e;
    }
    try {
      const [raw, allLists] = await Promise.all([fetchRawTasks(token), fetchListNames(token)]);
      const payload = { ...shape(raw), allLists, syncedAt: Date.now() };
      cache = { at: Date.now(), payload };
      return { ...payload, stale: false };
    } catch (err) {
      if (cache && !(err instanceof ClickUpAuthError)) return { ...cache.payload, stale: true }; // keep the last good data
      throw err;
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
