const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

export type DashboardGuardResult =
  | { ok: true; headers: Headers }
  | { ok: false; response: Response };

export async function guardDashboardRequest(
  req: Request,
  allowedMethods: string[],
): Promise<DashboardGuardResult> {
  const allowedOrigins = readAllowedOrigins();
  if (!allowedOrigins) {
    return {
      ok: false,
      response: dashboardJson(
        { error: "allowed_origins_missing_or_invalid" },
        503,
      ),
    };
  }

  const origin = req.headers.get("origin");
  if (!origin || origin === "null" || !allowedOrigins.has(origin)) {
    return {
      ok: false,
      response: dashboardJson({ error: "origin_not_allowed" }, 403),
    };
  }

  const corsHeaders = new Headers(NO_STORE_HEADERS);
  corsHeaders.set("Access-Control-Allow-Origin", origin);
  corsHeaders.set(
    "Access-Control-Allow-Headers",
    "content-type, x-dashboard-token",
  );
  corsHeaders.set(
    "Access-Control-Allow-Methods",
    [...allowedMethods, "OPTIONS"].join(", "),
  );
  corsHeaders.set("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return {
      ok: false,
      response: new Response(null, { status: 204, headers: corsHeaders }),
    };
  }

  if (!allowedMethods.includes(req.method)) {
    return {
      ok: false,
      response: dashboardJson(
        { error: "method_not_allowed" },
        405,
        corsHeaders,
      ),
    };
  }

  const expectedToken = Deno.env.get("DASHBOARD_TOKEN")?.trim();
  if (!expectedToken) {
    return {
      ok: false,
      response: dashboardJson(
        { error: "dashboard_token_missing" },
        503,
        corsHeaders,
      ),
    };
  }

  const suppliedToken = req.headers.get("x-dashboard-token")?.trim();
  if (!suppliedToken || !(await secureEqual(suppliedToken, expectedToken))) {
    return {
      ok: false,
      response: dashboardJson({ error: "unauthorized" }, 401, corsHeaders),
    };
  }

  return { ok: true, headers: corsHeaders };
}

export function dashboardJson(
  body: unknown,
  status = 200,
  responseHeaders?: HeadersInit,
) {
  const headers = new Headers(responseHeaders);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function readAllowedOrigins() {
  const raw = Deno.env.get("ALLOWED_ORIGINS")?.trim();
  if (!raw) return null;

  const origins = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (!origins.length || origins.some((origin) => !isValidOrigin(origin))) {
    return null;
  }

  return new Set(origins);
}

function isValidOrigin(value: string) {
  if (value === "null" || value === "*") return false;

  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === value;
  } catch {
    return false;
  }
}

async function secureEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;

  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }

  return difference === 0;
}
