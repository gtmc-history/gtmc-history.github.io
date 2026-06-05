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
  commentsCount?: number;
  commentSignal?: string;
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
    commentsCount: Number(summary.commentsCount || 0),
    commentSignal: String(summary.commentSignal || ""),
  };
}

function fallbackQuestion(summary: ReturnType<typeof sanitizeSummary>) {
  const topAxis = [...summary.axes as any[]]
    .sort((a, b) => Number(b?.pct || 0) - Number(a?.pct || 0))[0];
  const axisLabel = topAxis?.label || "가장 많이 선택된 경향";
  const classLabel = summary.class || "현재 반";

  return [
    {
      stage: "관찰",
      question: `${classLabel} 학생들은 "${axisLabel}" 쪽으로 기울었습니다. 이 결과를 만든 선택 장면은 무엇이었을까요?`,
      intent: "학생 선택을 증거처럼 읽기",
      followup: "많이 선택된 결과와 적게 선택된 결과를 함께 보면 무엇이 보이나요?",
    },
    {
      stage: "해석",
      question: `학생들이 "${axisLabel}" 판단을 설득력 있게 느낀 이유는 무엇일까요?`,
      intent: "선택 뒤에 있는 가치와 역사 인식 찾기",
      followup: "이 판단에는 어떤 감정, 경험, 기준이 들어 있을까요?",
    },
    {
      stage: "맥락",
      question: `이 판단은 당시 사람들이 마주한 제도, 권력 관계, 정보의 한계와 어떻게 연결될까요?`,
      intent: "개인 선택을 역사적 조건 속에 놓기",
      followup: "당시 사람들에게는 가능했지만 우리에게는 잘 보이지 않는 제약은 무엇일까요?",
    },
    {
      stage: "전이",
      question: `오늘 우리가 비슷한 문제를 판단한다면 개인의 선택과 구조의 제약 중 무엇을 먼저 살펴봐야 할까요?`,
      intent: "역사적 판단을 현재의 시민적 판단으로 확장하기",
      followup: "역사를 배우고 난 뒤 우리의 판단 기준은 어떻게 달라질 수 있을까요?",
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

  const provider = (Deno.env.get("AI_PROVIDER") || "gemini").toLowerCase();
  const system = [
    "당신은 한국사 교사의 수업 발문 설계를 돕는 조력자입니다.",
    "대시보드 데이터는 학생들의 게임 선택 결과이지, 당시 사람들이 실제로 선택한 통계가 아닙니다.",
    "학생 소감 원문은 제공되지 않습니다. commentsCount와 commentSignal은 대표성 판단의 보조 신호로만 사용하세요.",
    "발문은 차트 해설이 아니라 Doing History 토론을 여는 질문이어야 합니다.",
    "반드시 관찰, 해석, 맥락, 전이의 4단계로 구성하세요.",
    "관찰은 학생 선택 결과를 증거처럼 보게 하고, 해석은 학생 판단의 이유를 묻고, 맥락은 당시 제도와 권력 관계로 연결하고, 전이는 오늘의 시민적 판단으로 확장하세요.",
    "단정적 역사 해석, 학생 비난, 개인정보 추론은 금지합니다.",
    "질문은 고등학생 토론에 바로 쓸 수 있게 짧고 구체적으로 작성하세요.",
    "각 질문은 하나의 생각거리만 담고, 정답을 유도하지 마세요.",
  ].join("\n");

  const user = `다음 수업 대시보드 요약을 바탕으로 발문 4개를 JSON으로 제안하세요.

${JSON.stringify(summary, null, 2)}

응답 형식:
{"questions":[{"stage":"관찰","question":"...","intent":"...","followup":"..."},{"stage":"해석","question":"...","intent":"...","followup":"..."},{"stage":"맥락","question":"...","intent":"...","followup":"..."},{"stage":"전이","question":"...","intent":"...","followup":"..."}]}`;

  try {
    const parsed = provider === "openai"
      ? await callOpenAi(system, user)
      : await callGemini(system, user);
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.slice(0, 4)
      : fallbackQuestion(summary);

    return json({ questions, source: provider === "openai" ? "openai" : "gemini" });
  } catch (error) {
    console.error(error);
    const warning = error instanceof Error ? error.message : String(error);
    return json({ questions: fallbackQuestion(summary), source: "fallback", warning });
  }
});

async function callGemini(system: string, user: string) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    console.error("Gemini error", resp.status, detail.slice(0, 500));
    throw new Error("gemini_request_failed");
  }

  const data = await resp.json();
  const content = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "{}";
  return JSON.parse(content);
}

async function callOpenAi(system: string, user: string) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
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
    throw new Error("openai_request_failed");
  }

  const data = await resp.json();
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}
