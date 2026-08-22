import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  dashboardJson,
  guardDashboardRequest,
} from "../_shared/dashboard-security.ts";

const PROJECT_URL = Deno.env.get("SUPABASE_URL") || "https://xgniwztlrakkrbzcfklb.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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
    game_id: "balhae",
    label: "발해에서 고구려의 DNA를 찾아라",
    era: "남북국 시대",
    axes: [], scenes: [], sliders: [], endings: [],
  },
  {
    game_id: "gaehang",
    label: "개항의 갈림길 — 1876년 전야",
    era: "개항기",
    axes: [], scenes: [], sliders: [], endings: [],
    final_key: "stance",
    final_label: "개항에 대한 최종 입장",
    final_a: { key: "cheokhwa", label: "왜양일체론·척화", color: "c-red" },
    final_b: { key: "gaehwa", label: "통상개화론·개화", color: "c-blue" },
  },
  {
    game_id: "gendarme1910",
    label: "어느 기관의 일입니까?",
    era: "일제강점기 · 1910년대",
    axes: [], scenes: [], sliders: [], endings: [],
  },
  {
    game_id: "hoesaryeong1912",
    label: "허가받으시오 — 1912년, 회사를 세우다",
    era: "일제강점기 · 1910년대",
    axes: [], scenes: [], sliders: [], endings: [],
  },
  {
    game_id: "geunal1945",
    label: "그날, 아무도 몰랐다 — 1945",
    era: "일제강점기",
    axes: [], scenes: [], sliders: [], endings: [],
  },
  {
    game_id: "goryeo-debate",
    label: "고려 말 대논쟁 — 정몽주 vs 정도전",
    era: "고려 말",
    axes: [], scenes: [], sliders: [], endings: [],
  },
  {
    game_id: "haebang1945",
    label: "도둑같이 온 해방 — 1945",
    era: "일제강점기",
    axes: [],
    scenes: [],
    sliders: [],
    endings: [],
  },
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

const GAME_ID_ALIASES: Record<string, string> = {
  gabo1894: "gabo-reform",
};

Deno.serve(async (req: Request) => {
  const guard = await guardDashboardRequest(req, ["GET"]);
  if (!guard.ok) return guard.response;

  if (!SERVICE_ROLE_KEY) {
    return dashboardJson(
      { error: "service_role_key_missing" },
      500,
      guard.headers,
    );
  }

  try {
    const [results, meta] = await Promise.all([
      fetchTable("game_results", "select=*&order=timestamp.desc&limit=5000"),
      fetchTable("game_meta", "select=*"),
    ]);

    return dashboardJson(
      {
        results: Array.isArray(results)
          ? normalizeResults(results as ResultRow[])
          : [],
        meta: mergeFallbackMeta(Array.isArray(meta) ? meta : []),
      },
      200,
      guard.headers,
    );
  } catch (error) {
    console.error(error);
    const detail = error instanceof Error ? error.message : String(error);
    return dashboardJson(
      { error: "dashboard_data_failed", detail },
      500,
      guard.headers,
    );
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

  const game = GAME_ID_ALIASES[String(row.game || "")] || row.game;
  return {
    ...row,
    game,
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
    if (!row?.game_id) return;
    const gameId = GAME_ID_ALIASES[row.game_id] || row.game_id;
    if (row.game_id !== gameId && byId.has(gameId)) return;
    byId.set(gameId, { ...row, game_id: gameId });
  });
  FALLBACK_META.forEach((row) => {
    if (!byId.has(row.game_id)) byId.set(row.game_id, row);
  });
  return [...byId.values()];
}
