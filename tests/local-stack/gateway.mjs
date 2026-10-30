// Local stand-in for Supabase's API gateway: /auth/v1 → GoTrue, /rest/v1 → PostgREST,
// /storage/v1 → a tiny in-memory emulation of the Storage API (upload, remove, signed URL).
import http from "node:http";
import crypto from "node:crypto";
const files = new Map();
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
function proxy(req, res, port, path) {
  const p = http.request({ host: "127.0.0.1", port, path, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  p.on("error", (e) => send(res, 502, { message: String(e) }));
  req.pipe(p);
}
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/auth/v1")) return proxy(req, res, 9999, req.url.replace("/auth/v1", "") || "/");
  if (url.pathname.startsWith("/rest/v1")) return proxy(req, res, 3001, req.url.replace("/rest/v1", "") || "/");
  // Public buckets (the clinic logo) are readable by anyone, like real Supabase Storage.
  const pub = url.pathname.match(/^\/storage\/v1\/object\/public\/(branding)\/(.+)$/);
  if (pub && req.method === "GET") {
    const f = files.get(`${pub[1]}/${decodeURIComponent(pub[2])}`);
    if (!f) return send(res, 404, { message: "Object not found" });
    res.writeHead(200, { "content-type": f.type }); return res.end(f.data);
  }
  if (url.pathname.startsWith("/storage/v1")) {
    const role = (() => { try { return JSON.parse(Buffer.from((req.headers.authorization || "").split(".")[1] || "", "base64url")).role; } catch { return null; } })();
    if (role !== "service_role") return send(res, 403, { message: "only service_role in this emulator" });
    const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => {
      const body = Buffer.concat(chunks);
      let m;
      if ((m = url.pathname.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/))) {
        const key = `${m[1]}/${decodeURIComponent(m[2])}`;
        if (!files.has(key)) return send(res, 404, { message: "Object not found" });
        return send(res, 200, { signedURL: `/object/sign/${key}?token=${crypto.randomUUID()}` });
      }
      if ((m = url.pathname.match(/^\/storage\/v1\/object\/sign\/(.+)$/)) && req.method === "GET") {
        const f = files.get(decodeURIComponent(m[1])); if (!f) return send(res, 404, {});
        res.writeHead(200, { "content-type": f.type }); return res.end(f.data);
      }
      if ((m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/)) && (req.method === "POST" || req.method === "PUT")) {
        const key = `${m[1]}/${decodeURIComponent(m[2])}`;
        if (files.has(key) && req.headers["x-upsert"] !== "true") return send(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
        files.set(key, { data: body, type: req.headers["content-type"] || "application/octet-stream" });
        console.log(`[storage] stored ${key} (${body.length} bytes, ${req.headers["content-type"]})`);
        return send(res, 200, { Key: key, Id: crypto.randomUUID() });
      }
      if ((m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)$/)) && req.method === "DELETE") {
        const { prefixes = [] } = JSON.parse(body.toString() || "{}");
        prefixes.forEach((p) => files.delete(`${m[1]}/${p}`)); return send(res, 200, []);
      }
      send(res, 404, { message: `storage emulator: unhandled ${req.method} ${url.pathname}` });
    });
    return;
  }
  send(res, 404, { message: "not found" });
}).listen(54321, "127.0.0.1", () => console.log("gateway on :54321"));
