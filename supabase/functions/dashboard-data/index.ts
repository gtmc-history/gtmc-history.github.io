import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const DASHBOARD_TOKEN = Deno.env.get("DASHBOARD_TOKEN") || "charlie-dashboard-2026";
const PROJECT_URL = Deno.env.get("SUPABASE_URL") || "https://xgniwztlrakkrbzcfklb.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dashboard-token",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

type MetaRow = {
  game_id: string;
  label: string;
  era?: string;
  axes?: unknown[];
  scenes?: unknown[];
  sliders?: unknown[];
  endings?: unknown[];
  final_key?: string;
  final_label?: string;
  final_a?: unknown;
  final_b?: unknown;
};

type ResultRow = {
  game?: string;
  class?: string;
  timestamp?: string;
  comment?: string;
  choices?: unknown;
  [key: string]: unknown;
};

const FALLBACK_META: MetaRow[] = [
  {
    game_id: "gukchae1907",
    label: "대한신문 1907",
    era: "경제 구국 · 1907",
    axes: [],
    scenes: [],
    sliders: [],
    endings: [
      { key: "blocked", label: "게재 금지" },
      { key: "partial", label: "일부 삭제" },
      { key: "passed", label: "게재 허가" },
    ],
  },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const token = req.headers.get("x-dashboard-token");
  if (token !== DASHBOARD_TOKEN) return json({ error: "unauthorized" }, 401);
  if (!SERVICE_ROLE_KEY) return json({ error: "service_role_key_missing" }, 500);

  try {
    const [results, meta] = await Promise.all([
      fetchTable("game_results", "select=*&order=timestamp.desc&limit=5000"),
      fetchTable("game_meta", "select=*"),
    ]);

    return json({
      results: Array.isArray(results) ? normalizeResults(results as ResultRow[]) : [],
      meta: mergeFallbackMeta(Array.isArray(meta) ? meta : []),
    });
  } catch (error) {
    console.error(error);
    const detail = error instanceof Error ? error.message : String(error);
    return json({ error: "dashboard_data_failed", detail }, 500);
  }
});

async function fetchTable(table: string, query: string) {
  const resp = await fetch(`${PROJECT_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    const detail = await resp.text();
    console.error(`${table} fetch failed`, resp.status, detail.slice(0, 500));
    throw new Error(`${table}_fetch_failed`);
  }

  return await resp.json();
}

function normalizeResults(rows: ResultRow[]) {
  const out: ResultRow[] = [];
  const byAttempt = new Map<string, ResultRow>();

  rows.map(normalizeResultRow).forEach((row) => {
    const key = getAttemptKey(row);
    if (!key) {
      out.push(row);
      return;
    }

    const prev = byAttempt.get(key);
    byAttempt.set(key, prev ? mergeAttemptRows(prev, row) : row);
  });

  return [...out, ...byAttempt.values()]
    .sort((a, b) => new Date(String(b.timestamp || 0)).getTime() - new Date(String(a.timestamp || 0)).getTime());
}

function normalizeResultRow(row: ResultRow) {
  let choices = row.choices;
  if (typeof choices === "string") {
    try {
      choices = JSON.parse(choices);
    } catch {
      choices = {};
    }
  }

  return {
    ...row,
    choices: choices && typeof choices === "object" ? choices as Record<string, unknown> : {},
  };
}

function getAttemptKey(row: ResultRow) {
  const choices = row.choices as Record<string, unknown>;
  const id = choices?.result_id || choices?.attempt_id || choices?.submission_id;
  return id ? `${row.game || ""}|${row.class || ""}|${String(id)}` : "";
}

function mergeAttemptRows(a: ResultRow, b: ResultRow) {
  const aTime = new Date(String(a.timestamp || 0)).getTime();
  const bTime = new Date(String(b.timestamp || 0)).getTime();
  const newer = bTime >= aTime ? b : a;
  const older = bTime >= aTime ? a : b;
  const comment = String(b.comment || "").trim() || String(a.comment || "").trim();

  return {
    ...newer,
    choices: {
      ...(older.choices as Record<string, unknown>),
      ...(newer.choices as Record<string, unknown>),
    },
    comment,
  };
}

function mergeFallbackMeta(meta: MetaRow[]) {
  const byId = new Map<string, MetaRow>();
  meta.forEach((row) => {
    if (row?.game_id) byId.set(row.game_id, row);
  });
  FALLBACK_META.forEach((row) => {
    if (!byId.has(row.game_id)) byId.set(row.game_id, row);
  });
  return [...byId.values()];
}
