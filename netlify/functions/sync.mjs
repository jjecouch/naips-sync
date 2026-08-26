   import { getStore } from "@netlify/blobs";

   const CORS = {
     "Access-Control-Allow-Origin": "*",
     "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
     "Access-Control-Allow-Headers": "Content-Type",
   };
   const json = (obj, status = 200) =>
     new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

   export default async (req) => {
     if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS });

     const bucket = (new URL(req.url).searchParams.get("b") || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
     if (!bucket) return json({ error: "bad bucket" }, 400);

     const store = getStore("naips-sync");

     if (req.method === "GET") {
       const cur = await store.get(bucket, { type: "json" });
       return json(cur || { version: 0, data: null });
     }

     if (req.method === "PUT") {
       let body;
       try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
       const cur = (await store.get(bucket, { type: "json" })) || { version: 0, data: null };
       if ((body.version || 0) !== cur.version) return json({ error: "stale", version: cur.version }, 409);
       const next = { version: cur.version + 1, data: body.data };
       await store.setJSON(bucket, next);
       return json({ version: next.version });
     }

     return json({ error: "method not allowed" }, 405);
   };

   export const config = { path: "/sync" };
