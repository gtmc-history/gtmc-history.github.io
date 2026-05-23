import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const DASHBOARD_TOKEN = "charlie-dashboard-2026";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dashboard-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Summary = {
  game?: string;
  gameLabel?: string;
  era?: string;
  class?: string;
  total?: number;
  axes?: unknown[];
  scenes?: unknown[];
  endings?: unknown[];
  comments?: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function sanitizeSummary(summary: Summary) {
  return {
    game: String(summary.game || ""),
    gameLabel: String(summary.gameLabel || summary.game || ""),
    era: String(summary.era || ""),
    class: String(summary.class || ""),
    total: Number(summary.total || 0),
    axes: Array.isArray(summary.axes) ? summary.axes : [],
    scenes: Array.isArray(summary.scenes) ? summary.scenes : [],
    endings: Array.isArray(summary.endings) ? summary.endings : [],
    comments: Array.isArray(summary.comments)
      ? summary.comments.slice(0, 5).map((c) => String(c).slice(0, 120))
      : [],
  };
}

function fallbackQuestion(summary: ReturnType<typeof sanitizeSummary>) {
  const topAxis = [...summary.axes as any[]]
    .sort((a, b) => Number(b?.pct || 0) - Number(a?.pct || 0))[0];
  const axisLabel = topAxis?.label || "가장 많이 선택된 경향";

  return [
    {
      question: `${summary.class || "현재 반"} 학생들은 왜 "${axisLabel}" 쪽으로 판단했을까요?`,
      intent: "학생 선택을 먼저 해석하고 역사적 조건으로 연결하기",
      followup: "이 판단은 당시 사람들이 실제로 마주한 제약과 어디에서 닮거나 달랐을까요?",
    },
  ];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = req.headers.get("x-dashboard-token");
  if (token !== DASHBOARD_TOKEN) return json({ error: "unauthorized" }, 401);

  let payload: { summary?: Summary };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const summary = sanitizeSummary(payload.summary || {});
  if (!summary.game || !summary.total) {
    return json({ questions: fallbackQuestion(summary), source: "fallback" });
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return json({
      questions: fallbackQuestion(summary),
      source: "fallback",
      warning: "OPENAI_API_KEY is not set",
    });
  }

  const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
  const system = [
    "당신은 한국사 교사의 수업 발문 설계를 돕는 조력자입니다.",
    "대시보드 데이터는 학생들의 게임 선택 결과이지, 당시 사람들이 실제로 선택한 통계가 아닙니다.",
    "반드시 '학생들은 왜 이렇게 판단했는가'에서 출발한 뒤, '그 판단을 당시 역사적 조건과 어떻게 연결할 수 있는가'로 확장하세요.",
    "단정적 역사 해석, 학생 비난, 개인정보 추론은 금지합니다.",
    "질문은 고등학생 토론에 바로 쓸 수 있게 짧고 구체적으로 작성하세요.",
  ].join("\n");

  const user = `다음 수업 대시보드 요약을 바탕으로 발문 3개를 JSON으로 제안하세요.

${JSON.stringify(summary, null, 2)}

응답 형식:
{"questions":[{"question":"...","intent":"...","followup":"..."}]}`;

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.error("OpenAI error", resp.status, detail.slice(0, 500));
      return json({ questions: fallbackQuestion(summary), source: "fallback", warning: "ai_request_failed" });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.slice(0, 4)
      : fallbackQuestion(summary);

    return json({ questions, source: "openai" });
  } catch (error) {
    console.error(error);
    return json({ questions: fallbackQuestion(summary), source: "fallback", warning: "ai_parse_failed" });
  }
});
