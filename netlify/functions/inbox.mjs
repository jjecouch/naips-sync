// NAIPS briefing tool: the NAIPS inbox (Netlify Function, v2 style). Josh, 15 Nov 2026.
//
// GOES IN THE SAME GitHub REPOSITORY AS sync.mjs, as   netlify/functions/inbox.mjs
// Netlify rebuilds the site on its own when the file is added. sync.mjs is not touched.
//
// What it is for: a share-sheet Shortcut on the iPad sends a NAIPS briefing PDF here, and the briefing tool
// collects it (and briefs it) the next time it looks, then deletes it. It holds PDFs, not your synced data.
//
// The address is the inbox id (64 hex characters) the tool shows in Settings, Cloud sync. The tool works it
// out from your sync passphrase, so both iPads look in the same inbox; nobody without the id can put a PDF in
// or take one out. Unlike the sync store, a PDF waits here unencrypted (a Shortcut cannot do the encryption):
// it is NAIPS data, it is deleted as soon as the tool takes it, and anything left after 24 hours is cleared.
//
//   POST   /inbox?i=<id>           body: the PDF itself        -> {ok, waiting, message}
//   GET    /inbox?i=<id>                                       -> {items:[{k, at}]}  (oldest first)
//   GET    /inbox?i=<id>&k=<k>                                 -> the PDF
//   DELETE /inbox?i=<id>&k=<k>                                 -> {ok}

import { getStore } from "@netlify/blobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MAX_BYTES = 5 * 1024 * 1024;   // a big NAIPS saved list is well under 1 MB
const KEEP_MS = 24 * 3600 * 1000;    // anything not collected in a day is cleared
const MAX_WAITING = 20;              // a runaway Shortcut cannot fill the store

export default async (req) => {
  // A 204 carries no body: new Response("", ...) throws "Invalid response status code 204" in Node.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const id = (url.searchParams.get("i") || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return json({ error: "bad inbox" }, 400);
  const k = url.searchParams.get("k") || "";
  if (k && !/^\d{13}-[a-z0-9]{6}$/.test(k)) return json({ error: "bad item" }, 400);

  const store = getStore("naips-inbox");

  // Housekeeping on every call: what is older than a day goes.
  const now = Date.now();
  const { blobs } = await store.list({ prefix: id + "/" });
  const live = [];
  for (const b of blobs) {
    const key = b.key.slice(id.length + 1);
    const at = +key.split("-")[0];
    if (!(now - at < KEEP_MS)) await store.delete(b.key);
    else live.push({ k: key, at });
  }
  live.sort((a, b) => a.at - b.at);

  if (req.method === "POST") {
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) return json({ error: "empty", message: "Nothing was sent. Share the NAIPS PDF itself." }, 400);
    if (buf.byteLength > MAX_BYTES) return json({ error: "too big", message: "That file is over 5 MB." }, 413);
    const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
    if (head !== "%PDF-") return json({ error: "not a pdf", message: "That wasn't a PDF. Share the NAIPS PDF itself." }, 415);
    if (live.length >= MAX_WAITING) return json({ error: "full", message: "The inbox already has 20 waiting. Open the briefing tool to collect them." }, 429);
    const key = `${now}-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
    await store.set(`${id}/${key}`, buf, { metadata: { at: now, size: buf.byteLength } });
    const n = live.length + 1;
    return json({ ok: true, waiting: n, message: `Sent to the briefing tool${n > 1 ? ` (${n} waiting)` : ""}.` });
  }

  if (req.method === "GET" && k) {
    const data = await store.get(`${id}/${k}`, { type: "arrayBuffer" });
    if (!data) return json({ error: "gone" }, 404);
    return new Response(data, { status: 200, headers: { ...CORS, "Content-Type": "application/pdf" } });
  }

  if (req.method === "GET") return json({ items: live });

  if (req.method === "DELETE") {
    if (!k) return json({ error: "which item?" }, 400);
    await store.delete(`${id}/${k}`);
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/inbox" };
