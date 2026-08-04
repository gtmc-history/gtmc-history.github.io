import { getCorsHeaders } from "../_shared/cors.ts";
import { insertEvent } from "../_shared/db.ts";
import { sessionHash } from "../_shared/security.ts";

const EVENTS = new Set([
  "demo_started", "material_viewed", "initial_submitted", "initial_feedback_shown",
  "revision_submitted", "comparison_shown", "resource_form_clicked", "resource_file_clicked",
  "demo_restarted", "completed", "api_fallback", "api_error"
]);

export default {
  async fetch(req: Request) {
    const { permitted, headers } = getCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (!permitted) return response({ error: "ORIGIN_NOT_ALLOWED" }, 403, headers);
    if (req.method !== "POST") return response({ error: "METHOD_NOT_ALLOWED" }, 405, headers);
    try {
      const body = await req.json();
      if (!EVENTS.has(body.eventType)) return response({ error: "INVALID_EVENT" }, 400, headers);
      const hash = await sessionHash(String(body.sessionId ?? crypto.randomUUID()));
      await insertEvent({
        session_hash: hash,
        source: ["expo2026", "conference2026", "direct"].includes(body.source) ? body.source : "direct",
        event_type: body.eventType,
        content_id: String(body.contentId ?? "unknown").slice(0, 80),
        prompt_version: "question-demo-v1.0",
        initial_level: ["L1", "L2", "L3"].includes(body.initialLevel) ? body.initialLevel : null,
        revised_level: ["L1", "L2", "L3"].includes(body.revisedLevel) ? body.revisedLevel : null,
        processing_ms: null,
        fallback_used: Boolean(body.fallbackUsed),
        error_code: null,
        resource_id: body.resourceId ? String(body.resourceId).slice(0, 40) : null
      });
      return response({ ok: true }, 200, headers);
    } catch {
      return response({ error: "INTERNAL_ERROR" }, 500, headers);
    }
  }
};

function response(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "content-type": "application/json", "cache-control": "no-store" } });
}
