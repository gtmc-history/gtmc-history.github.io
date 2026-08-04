import type { LevelCode, QuestionFeatures } from "./rules.ts";

export type ClaudeAnalysis = {
  levelCode: LevelCode;
  levelLabel: string;
  features: QuestionFeatures;
  strength: string;
  nextStep: string;
  rewriteHint: string;
  changeTags: string[];
  comparison: string;
  safety: {
    containsAnswer: boolean;
    containsFullRewrite: boolean;
  };
};

export type ClaudeAnalysisContext = {
  stage: "initial" | "revision";
  material: string;
  question: string;
  originalQuestion?: string;
};

export const CLAUDE_MODEL_ID = "claude-haiku-4-5-20251001";
export const CLAUDE_TIMEOUT_MS = 7000;

export const ANTHROPIC_DIAGNOSTIC_CODES = [
  "ANTHROPIC_KEY_MISSING",
  "ANTHROPIC_HTTP_400",
  "ANTHROPIC_HTTP_401",
  "ANTHROPIC_HTTP_403",
  "ANTHROPIC_HTTP_404",
  "ANTHROPIC_HTTP_429",
  "ANTHROPIC_HTTP_500",
  "ANTHROPIC_HTTP_504",
  "ANTHROPIC_HTTP_529",
  "ANTHROPIC_TIMEOUT",
  "ANTHROPIC_NETWORK_ERROR",
  "ANTHROPIC_INVALID_JSON",
  "ANTHROPIC_UNSAFE_OUTPUT",
  "ANTHROPIC_REQUEST_ID_MISMATCH",
  "ANTHROPIC_UNKNOWN_ERROR",
] as const;

export type AnthropicDiagnosticCode = typeof ANTHROPIC_DIAGNOSTIC_CODES[number];
export type AnthropicDiagnostic = {
  diagnosticCode: AnthropicDiagnosticCode;
  httpStatus: number | null;
};

class AnthropicFailure extends Error {
  diagnosticCode: AnthropicDiagnosticCode;
  httpStatus: number | null;
  retryAfterMs: number | null;

  constructor(
    diagnosticCode: AnthropicDiagnosticCode,
    httpStatus: number | null = null,
    retryAfterMs: number | null = null,
  ) {
    super(diagnosticCode);
    this.name = "AnthropicFailure";
    this.diagnosticCode = diagnosticCode;
    this.httpStatus = httpStatus;
    this.retryAfterMs = retryAfterMs;
  }
}

export function getAnthropicDiagnostic(error: unknown): AnthropicDiagnostic {
  if (error instanceof AnthropicFailure) {
    return { diagnosticCode: error.diagnosticCode, httpStatus: error.httpStatus };
  }
  const knownMessage = error instanceof Error ? error.message : "";
  if (["CLAUDE_CONTAINS_ANSWER", "CLAUDE_CONTAINS_FULL_REWRITE", "CLAUDE_INVALID_SAFETY"].includes(knownMessage)) {
    return { diagnosticCode: "ANTHROPIC_UNSAFE_OUTPUT", httpStatus: 200 };
  }
  if (["REQUEST_ID_MISMATCH", "ANTHROPIC_REQUEST_ID_MISMATCH"].includes(knownMessage)) {
    return { diagnosticCode: "ANTHROPIC_REQUEST_ID_MISMATCH", httpStatus: 200 };
  }
  return { diagnosticCode: "ANTHROPIC_UNKNOWN_ERROR", httpStatus: null };
}

const FEATURE_PROPERTIES = {
  directlyAnswerable: { type: "boolean" },
  hasCause: { type: "boolean" },
  hasRelation: { type: "boolean" },
  hasComparison: { type: "boolean" },
  hasEvaluation: { type: "boolean" },
  hasPerspective: { type: "boolean" },
  hasHistoricalMeaning: { type: "boolean" },
  hasCounterfactual: { type: "boolean" },
  requiresEvidence: { type: "boolean" },
} as const;

export const CLAUDE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    levelCode: { type: "string", enum: ["L1", "L2", "L3"] },
    levelLabel: { type: "string", enum: ["사실·정보 확인형", "관계 탐색형", "비교·평가·해석형"] },
    features: {
      type: "object",
      properties: FEATURE_PROPERTIES,
      required: Object.keys(FEATURE_PROPERTIES),
      additionalProperties: false,
    },
    strength: { type: "string", description: "질문의 강점 한 문장. 역사 정답을 포함하지 않는다." },
    nextStep: { type: "string", description: "다음 탐구 방향 한 문장. 완성 질문을 대신 쓰지 않는다." },
    rewriteHint: { type: "string", description: "핵심어 또는 문장 요소만 제시한다. 완성 질문을 쓰지 않는다." },
    changeTags: { type: "array", items: { type: "string" }, description: "수정 단계의 변화 태그. 최초 질문이면 빈 배열." },
    comparison: { type: "string", description: "수정 단계의 전후 변화 설명. 최초 질문이면 빈 문자열." },
    safety: {
      type: "object",
      properties: {
        containsAnswer: { type: "boolean" },
        containsFullRewrite: { type: "boolean" },
      },
      required: ["containsAnswer", "containsFullRewrite"],
      additionalProperties: false,
    },
  },
  required: [
    "levelCode",
    "levelLabel",
    "features",
    "strength",
    "nextStep",
    "rewriteHint",
    "changeTags",
    "comparison",
    "safety",
  ],
  additionalProperties: false,
} as const;

export const CLAUDE_SYSTEM_PROMPT = `당신은 고등학교 한국사 질문 코치다.
제공된 역사 자료만 사용해 질문 수준과 코칭 피드백을 함께 판정한다.

판정 기준:
- L1 사실·정보 확인형: 자료에서 직접 답을 찾을 수 있는 누가, 언제, 어디서, 무엇, 행방, 단순 결과 질문.
- L2 관계 탐색형: 원인·영향·조건·선택·변화를 연결하며 단순 사실을 넘어 관계를 설명해야 하는 질문.
- L3 비교·평가·해석형: 비교, 관점, 역사적 의미, 대안, 반사실을 근거로 판단해야 하는 질문.
- 특정 단어 하나만으로 수준을 올리지 말고, 자료에서 직접 답할 수 있는지를 먼저 확인한다.

회귀 기준:
1. “해산된 군인은 어디로 갔을까?” → L1
2. “해산 군인들이 의병에 합류한 이유는 무엇일까?” → L2
3. “군대 해산이 의병 운동의 성격을 어떻게 바꾸었을까?” → L2
4. “군대 해산은 일본의 지배 강화에 얼마나 효과적이었을까?” → L3
5. “군대 해산과 고종 강제 퇴위 중 의병 확대에 더 큰 영향을 준 것은 무엇일까?” → L3

안전 규칙:
- 역사 정답이나 해설을 반환하지 않는다.
- 사용자를 대신한 완성 질문을 반환하지 않는다.
- rewriteHint는 핵심어·조건·관점 같은 요소만 제시한다.
- containsAnswer와 containsFullRewrite를 보수적으로 판정한다.
- 질문 원문을 그대로 반복하지 않는다.
- 지정된 JSON Schema만 반환한다.`;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function analyzeWithClaude(
  context: ClaudeAnalysisContext,
  options: { fetchImpl?: FetchLike } = {},
): Promise<ClaudeAnalysis> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new AnthropicFailure("ANTHROPIC_KEY_MISSING");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);
  try {
    return await requestWithOneRetry(context, apiKey, options.fetchImpl ?? fetch, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new AnthropicFailure("ANTHROPIC_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestWithOneRetry(
  context: ClaudeAnalysisContext,
  apiKey: string,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<ClaudeAnalysis> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestClaude(context, apiKey, fetchImpl, signal);
    } catch (error) {
      if (attempt > 0 || !isRetryable(error)) throw error;
      const delayMs = error instanceof AnthropicFailure && error.retryAfterMs !== null
        ? error.retryAfterMs
        : 250;
      await wait(delayMs, signal);
    }
  }
  throw new AnthropicFailure("ANTHROPIC_UNKNOWN_ERROR");
}

async function requestClaude(
  context: ClaudeAnalysisContext,
  apiKey: string,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<ClaudeAnalysis> {
  let response: Response;
  try {
    response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL_ID,
        max_tokens: 700,
        system: CLAUDE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(context) }],
        output_config: {
          format: {
            type: "json_schema",
            schema: CLAUDE_OUTPUT_SCHEMA,
          },
        },
      }),
    });
  } catch {
    if (signal.aborted) throw new AnthropicFailure("ANTHROPIC_TIMEOUT");
    throw new AnthropicFailure("ANTHROPIC_NETWORK_ERROR");
  }

  if (!response.ok) {
    throw new AnthropicFailure(
      diagnosticForHttpStatus(response.status),
      response.status,
      parseRetryAfter(response.headers.get("retry-after")),
    );
  }

  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    throw new AnthropicFailure("ANTHROPIC_INVALID_JSON", 200);
  }
  if (data.stop_reason === "refusal" || data.stop_reason === "max_tokens") {
    throw new AnthropicFailure("ANTHROPIC_UNKNOWN_ERROR", 200);
  }
  const blocks = Array.isArray(data.content) ? data.content : [];
  const text = blocks.find((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")?.text;
  if (typeof text !== "string") throw new AnthropicFailure("ANTHROPIC_INVALID_JSON", 200);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AnthropicFailure("ANTHROPIC_INVALID_JSON", 200);
  }
  return validateClaudeAnalysis(parsed, context.stage);
}

function buildUserPrompt(context: ClaudeAnalysisContext) {
  if (context.stage === "revision") {
    return `서버 고정 역사 자료:\n${context.material}\n\n처음 질문:\n${context.originalQuestion ?? ""}\n\n수정 질문:\n${context.question}\n\n수정 질문의 수준과 특징을 판정하고, 전후 변화와 다음 수정 요소를 코칭하라.`;
  }
  return `서버 고정 역사 자료:\n${context.material}\n\n사용자 질문:\n${context.question}\n\n질문의 수준과 특징을 판정하고, 강점·다음 탐구 방향·다시 쓰기 요소를 코칭하라.`;
}

function validateClaudeAnalysis(value: unknown, stage: "initial" | "revision"): ClaudeAnalysis {
  if (!isRecord(value)) throw invalidOutput();
  const normalizedLevel = typeof value.levelCode === "string" ? value.levelCode.toUpperCase() : "";
  if (!(["L1", "L2", "L3"] as string[]).includes(normalizedLevel)) throw invalidOutput();
  if (!isRecord(value.features) || !Object.keys(FEATURE_PROPERTIES).every((key) => typeof value.features[key] === "boolean")) {
    throw invalidOutput();
  }
  if (![value.strength, value.nextStep, value.rewriteHint, value.comparison].every((item) => typeof item === "string")) {
    throw invalidOutput();
  }
  if (!String(value.strength).trim() || !String(value.nextStep).trim() || !String(value.rewriteHint).trim()) {
    throw invalidOutput();
  }
  if (stage === "revision" && !String(value.comparison).trim()) throw invalidOutput();
  if (!Array.isArray(value.changeTags) || !value.changeTags.every((item) => typeof item === "string")) {
    throw invalidOutput();
  }
  if (!isRecord(value.safety)
    || typeof value.safety.containsAnswer !== "boolean"
    || typeof value.safety.containsFullRewrite !== "boolean") {
    throw invalidOutput();
  }

  const levelCode = normalizedLevel as LevelCode;
  const labels: Record<LevelCode, string> = {
    L1: "사실·정보 확인형",
    L2: "관계 탐색형",
    L3: "비교·평가·해석형",
  };
  return {
    levelCode,
    levelLabel: labels[levelCode],
    features: value.features as QuestionFeatures,
    strength: String(value.strength).trim(),
    nextStep: String(value.nextStep).trim(),
    rewriteHint: String(value.rewriteHint).trim(),
    changeTags: value.changeTags.map((item) => item.trim()).filter(Boolean).slice(0, 4),
    comparison: String(value.comparison).trim(),
    safety: {
      containsAnswer: value.safety.containsAnswer,
      containsFullRewrite: value.safety.containsFullRewrite,
    },
  };
}

function invalidOutput() {
  return new AnthropicFailure("ANTHROPIC_INVALID_JSON", 200);
}

function isRetryable(error: unknown) {
  return error instanceof AnthropicFailure && error.httpStatus !== null && [429, 500, 504, 529].includes(error.httpStatus);
}

function diagnosticForHttpStatus(status: number): AnthropicDiagnosticCode {
  const supported: Record<number, AnthropicDiagnosticCode> = {
    400: "ANTHROPIC_HTTP_400",
    401: "ANTHROPIC_HTTP_401",
    403: "ANTHROPIC_HTTP_403",
    404: "ANTHROPIC_HTTP_404",
    429: "ANTHROPIC_HTTP_429",
    500: "ANTHROPIC_HTTP_500",
    504: "ANTHROPIC_HTTP_504",
    529: "ANTHROPIC_HTTP_529",
  };
  return supported[status] ?? "ANTHROPIC_UNKNOWN_ERROR";
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
