type InitialContext = {
  material: string;
  question: string;
  levelCode: string;
  levelLabel: string;
  features: Record<string, boolean>;
};

type RevisionContext = {
  material: string;
  originalQuestion: string;
  revisedQuestion: string;
  initialLevelCode: string;
  revisedLevelCode: string;
  changeTags: string[];
};

const INITIAL_SCHEMA = {
  type: "object",
  properties: {
    strength: { type: "string", description: "90자 이내의 구체적인 강점 한 문장" },
    nextStep: { type: "string", description: "100자 이내의 보완 방향 한 문장" },
    rewriteHint: { type: "string", description: "완성 질문이 아닌 핵심어·문장 요소 힌트, 100자 이내" },
    safety: { type: "string", enum: ["ok", "blocked"] }
  },
  required: ["strength", "nextStep", "rewriteHint", "safety"],
  additionalProperties: false
};

const REVISION_SCHEMA = {
  type: "object",
  properties: {
    comparison: { type: "string", description: "전후 변화 설명, 180자 이내" },
    nextTry: { type: "string", description: "다음 수정 방향, 100자 이내" },
    safety: { type: "string", enum: ["ok", "blocked"] }
  },
  required: ["comparison", "nextTry", "safety"],
  additionalProperties: false
};

const SYSTEM = `당신은 고등학교 한국사 질문 코치다.
- 질문에 대한 역사 정답·해설을 제공하지 않는다.
- 사용자를 대신해 완성된 대체 질문을 작성하지 않는다.
- 규칙 엔진이 제공한 수준 코드를 바꾸지 않는다.
- 제공된 역사 자료와 특징만 사용하고 새로운 사실을 덧붙이지 않는다.
- 평가·비난 표현을 피한다.
- 사용자가 스스로 질문을 다시 쓰게 하는 짧고 구체적인 한국어만 작성한다.
- 지정된 JSON Schema만 반환한다.`;

export async function createInitialFeedback(context: InitialContext, signal: AbortSignal) {
  return callClaude({
    schema: INITIAL_SCHEMA,
    maxTokens: 320,
    signal,
    user: `역사 자료:\n${context.material}\n\n사용자 질문:\n${context.question}\n\n규칙 판정:\n${context.levelCode} ${context.levelLabel}\n특징:\n${JSON.stringify(context.features)}\n\n강점 1문장, 더 생각할 점 1문장, 완성 질문이 아닌 다시 쓰기 힌트 1문장을 작성하라.`
  });
}

export async function createComparison(context: RevisionContext, signal: AbortSignal) {
  return callClaude({
    schema: REVISION_SCHEMA,
    maxTokens: 300,
    signal,
    user: `역사 자료:\n${context.material}\n\n처음 질문:\n${context.originalQuestion}\n\n수정 질문:\n${context.revisedQuestion}\n\n규칙 판정:\n${context.initialLevelCode} → ${context.revisedLevelCode}\n변화 태그:\n${context.changeTags.join(", ") || "표현 정리"}\n\n수준 상승만 강조하지 말고 실제 변화가 무엇인지 설명하라. 완성 질문은 쓰지 말라.`
  });
}

async function callClaude({ schema, maxTokens, signal, user }: { schema: object; maxTokens: number; signal: AbortSignal; user: string }) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("MISSING_ANTHROPIC_API_KEY");
  const model = Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema } }
    })
  });

  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    const error = new Error(`ANTHROPIC_${response.status}`) as Error & { status?: number; retryAfter?: string | null };
    error.status = response.status;
    error.retryAfter = retryAfter;
    throw error;
  }

  const data = await response.json();
  if (data.stop_reason === "refusal" || data.stop_reason === "max_tokens") throw new Error(`ANTHROPIC_STOP_${data.stop_reason}`);
  const text = data.content?.find((block: { type: string; text?: string }) => block.type === "text")?.text;
  if (!text) throw new Error("ANTHROPIC_EMPTY_TEXT");
  return JSON.parse(text);
}
