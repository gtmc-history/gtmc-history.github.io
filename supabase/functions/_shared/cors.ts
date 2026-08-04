export function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const permitted = !origin || isLocal || allowed.includes(origin);
  return {
    permitted,
    headers: {
      "Access-Control-Allow-Origin": permitted && origin ? origin : allowed[0] ?? "null",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Vary": "Origin"
    }
  };
}
