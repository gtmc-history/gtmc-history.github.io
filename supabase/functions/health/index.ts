import { getCorsHeaders } from "../_shared/cors.ts";

export default {
  async fetch(req: Request) {
    const { permitted, headers } = getCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (!permitted) return new Response(JSON.stringify({ ok: false }), { status: 403, headers: { ...headers, "content-type": "application/json" } });
    const configured = Boolean(Deno.env.get("ANTHROPIC_API_KEY") && Deno.env.get("CLAUDE_MODEL"));
    return new Response(JSON.stringify({ ok: true, configured, timestamp: new Date().toISOString() }), { headers: { ...headers, "content-type": "application/json", "cache-control": "no-store" } });
  }
};
