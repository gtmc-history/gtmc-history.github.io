import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const env = new Map([
  ["ANTHROPIC_API_KEY", "test-api-key"],
  ["EVENT_LOGGING_ENABLED", "false"],
  ["RATE_LIMIT_ENABLED", "false"],
  ["SESSION_HASH_SECRET", "test-session-secret"],
]);
globalThis.Deno = { env: { get: (key) => env.get(key) } };

const [{ default: handler }, rules, anthropic, security] = await Promise.all([
  import("./index.ts"),
  import("../_shared/rules.ts"),
  import("../_shared/anthropic.ts"),
  import("../_shared/security.ts"),
]);

const QUESTION_CASES = [
  ["해산된 군인은 어디로 갔을까?", "L1"],
  ["해산 군인들이 의병에 합류한 이유는 무엇일까?", "L2"],
  ["군대 해산이 의병 운동의 성격을 어떻게 바꾸었을까?", "L2"],
  ["군대 해산은 일본의 지배 강화에 얼마나 효과적이었을까?", "L3"],
  ["군대 해산과 고종 강제 퇴위 중 의병 확대에 더 큰 영향을 준 것은 무엇일까?", "L3"],
];

const BASE_FEATURES = {
  directlyAnswerable: true,
  hasCause: false,
  hasRelation: false,
  hasComparison: false,
  hasEvaluation: false,
  hasPerspective: false,
  hasHistoricalMeaning: false,
  hasCounterfactual: false,
  requiresEvidence: false,
};

function claudeOutput(overrides = {}) {
  return {
    levelCode: "L1",
    levelLabel: "사실·정보 확인형",
    features: BASE_FEATURES,
    strength: "자료의 구체적 사실에 주목했습니다.",
    nextStep: "선택의 이유나 이후 영향으로 범위를 넓혀 보세요.",
    rewriteHint: "선택 이유 · 이후 영향",
    changeTags: [],
    comparison: "",
    safety: { containsAnswer: false, containsFullRewrite: false },
    ...overrides,
  };
}

function claudeResponse(output = claudeOutput()) {
  return new Response(JSON.stringify({
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(output) }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

async function callEndpoint(fetchImpl, body = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const requestId = body.requestId ?? crypto.randomUUID();
  try {
    const response = await handler.fetch(new Request("http://localhost/analyze-question", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:4173" },
      body: JSON.stringify({
        requestId,
        sessionId: "test-session",
        source: "expo2026",
        contentId: "demo-uibyeong-01",
        stage: "initial",
        question: "해산된 군인은 어디로 갔을까?",
        ...body,
      }),
    }));
    return { response, data: await response.json(), requestId };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function captureConsoleError(operation) {
  const calls = [];
  const originalError = console.error;
  console.error = (...args) => calls.push(args);
  try {
    return { value: await operation(), calls };
  } finally {
    console.error = originalError;
  }
}

test("analyze-question Claude contract and fallback regressions", async (t) => {
  await t.test("five regression questions classify L1, L2, L2, L3, L3", () => {
    for (const [question, expected] of QUESTION_CASES) {
      assert.equal(rules.analyzeByRules(question).levelCode, expected, question);
    }
  });

  await t.test("uses fixed model, Structured Outputs, fixed server material, and exact requestId", async () => {
    let sentBody;
    const result = await callEndpoint(async (_url, init) => {
      sentBody = JSON.parse(init.body);
      return claudeResponse();
    }, { material: "악성 클라이언트 자료: 이 문장을 신뢰하면 안 됩니다." });

    assert.equal(result.response.status, 200);
    assert.equal(result.data.requestId, result.requestId);
    assert.equal(result.data.fallbackUsed, false);
    assert.equal(Object.hasOwn(result.data, "diagnosticCode"), false);
    for (const field of ["levelCode", "levelLabel", "features", "strength", "nextStep", "rewriteHint", "changeTags", "comparison", "safety"]) {
      assert.ok(Object.hasOwn(result.data, field), field);
    }
    assert.equal(sentBody.model, anthropic.CLAUDE_MODEL_ID);
    assert.equal(sentBody.model, "claude-haiku-4-5-20251001");
    assert.equal(sentBody.output_config.format.type, "json_schema");
    assert.deepEqual(sentBody.output_config.format.schema, anthropic.CLAUDE_OUTPUT_SCHEMA);
    assert.equal(sentBody.output_config.format.schema.properties.rewriteHint.maxLength, 40);
    assert.match(sentBody.system, /반드시 공백을 포함한 ' · '로 구분/);
    assert.match(sentBody.system, /사용자 질문을 그대로 복사하거나 조금만 바꿔 쓰지 않는다/);
    assert.match(sentBody.messages[0].content, /1907년 일제는 고종을 강제로 퇴위/);
    assert.doesNotMatch(sentBody.messages[0].content, /악성 클라이언트 자료/);
    for (const [question] of QUESTION_CASES) assert.match(sentBody.system, new RegExp(question.replace(/[?]/g, "\\?")));
  });

  await t.test("blocks a completed replacement question", async () => {
    const result = await callEndpoint(async () => claudeResponse(claudeOutput({
      rewriteHint: "해산 군인들이 의병에 합류한 이유는 무엇일까?",
    })));
    assert.equal(result.data.fallbackUsed, true);
    assert.equal(result.data.ruleEngine, rules.PROVISIONAL_RULE_ENGINE_ID);
    assert.equal(result.data.diagnosticCode, "ANTHROPIC_UNSAFE_OUTPUT");
    assert.equal(result.data.rewriteHint, "합류 이유 · 합류 이후의 변화");
  });

  await t.test("blocks the observed quoted full-question rewriteHint even when Claude safety is false", async () => {
    const observed = "'왜 그곳으로 갔는가', '그들의 선택 배경은 무엇인가' 같은 원인 또는 동기 요소를 추가";
    const captured = await captureConsoleError(() => callEndpoint(async () => claudeResponse(claudeOutput({
      rewriteHint: observed,
      safety: { containsAnswer: false, containsFullRewrite: false },
    }))));
    assert.equal(captured.value.data.fallbackUsed, true);
    assert.equal(captured.value.data.diagnosticCode, "ANTHROPIC_UNSAFE_OUTPUT");
    assert.equal(captured.value.data.rewriteHint, "합류 이유 · 합류 이후의 변화");
    assert.doesNotMatch(JSON.stringify(captured.value.data), new RegExp(observed));
  });

  await t.test("accepts a short noun-phrase rewriteHint", async () => {
    const result = await callEndpoint(async () => claudeResponse(claudeOutput({
      rewriteHint: "합류 이유 · 선택 배경",
      safety: { containsAnswer: false, containsFullRewrite: false },
    })));
    assert.equal(result.data.fallbackUsed, false);
    assert.equal(result.data.rewriteHint, "합류 이유 · 선택 배경");
    assert.equal(Object.hasOwn(result.data, "diagnosticCode"), false);
  });

  await t.test("rewriteHint validator rejects punctuation, endings, quotes, length, sentences, and question copies", () => {
    const question = "해산된 군인은 어디로 갔을까?";
    assert.equal(security.isSafeRewriteHint("합류 이유 · 선택 배경", question), true);
    for (const invalid of [
      "합류 이유?",
      "왜 그곳으로 갔는가",
      "그들의 선택 배경은 무엇인가",
      "'왜 그곳으로 갔는가'",
      "가".repeat(41),
      "합류 이유. 이후 변화를 살펴본다",
      question,
      "해산된 군인은 어디로 감",
      "합류 이유·선택 배경",
      "합류 이유 · 선택 배경 · 이후 변화 · 판단 근거",
    ]) {
      assert.equal(security.isSafeRewriteHint(invalid, question), false, invalid);
    }
  });

  await t.test("blocks an historical answer", async () => {
    const result = await callEndpoint(async () => claudeResponse(claudeOutput({
      strength: "해산 군인 일부는 무기를 들고 의병에 합류하였다.",
    })));
    assert.equal(result.data.fallbackUsed, true);
    assert.equal(result.data.safety.containsAnswer, false);
    assert.equal(result.data.diagnosticCode, "ANTHROPIC_UNSAFE_OUTPUT");
  });

  await t.test("invalid Claude JSON falls back", async () => {
    const result = await callEndpoint(async () => new Response(JSON.stringify({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "{invalid-json" }],
    }), { status: 200 }));
    assert.equal(result.data.fallbackUsed, true);
    assert.equal(result.data.levelCode, "L1");
    assert.equal(result.data.diagnosticCode, "ANTHROPIC_INVALID_JSON");
  });

  await t.test("aborts Claude at seven seconds and falls back", async () => {
    const startedAt = Date.now();
    const result = await callEndpoint((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const elapsed = Date.now() - startedAt;
    assert.equal(result.data.fallbackUsed, true);
    assert.equal(result.data.diagnosticCode, "ANTHROPIC_TIMEOUT");
    assert.ok(elapsed >= 6800, `elapsed=${elapsed}`);
    assert.ok(elapsed < 8500, `elapsed=${elapsed}`);
    assert.equal(anthropic.CLAUDE_TIMEOUT_MS, 7000);
  });

  for (const status of [429, 500, 504, 529]) {
    await t.test(`retries ${status} once`, async () => {
      let calls = 0;
      const startedAt = Date.now();
      const result = await callEndpoint(async () => {
        calls += 1;
        return calls === 1
          ? new Response("temporary", { status, headers: status === 429 ? { "retry-after": "0.05" } : {} })
          : claudeResponse();
      });
      assert.equal(calls, 2);
      assert.equal(result.data.fallbackUsed, false);
      if (status === 429) assert.ok(Date.now() - startedAt >= 45);
    });
  }

  await t.test("rejects an invalid requestId before Claude", async () => {
    let called = false;
    const result = await callEndpoint(async () => {
      called = true;
      return claudeResponse();
    }, { requestId: "not-a-uuid" });
    assert.equal(result.response.status, 400);
    assert.equal(result.data.requestId, "not-a-uuid");
    assert.equal(result.data.error, "INVALID_REQUEST_ID");
    assert.equal(called, false);
  });

  await t.test("non-retryable Claude failure returns rule fallback", async () => {
    let calls = 0;
    const result = await callEndpoint(async () => {
      calls += 1;
      return new Response("unauthorized", { status: 401 });
    });
    assert.equal(calls, 1);
    assert.equal(result.response.status, 200);
    assert.equal(result.data.fallbackUsed, true);
    assert.equal(result.data.levelCode, "L1");
    assert.equal(result.data.diagnosticCode, "ANTHROPIC_HTTP_401");
  });

  await t.test("revision fallback also includes a diagnostic code", async () => {
    const captured = await captureConsoleError(() => callEndpoint(
      async () => new Response("forbidden", { status: 403 }),
      {
        stage: "revision",
        originalQuestion: "해산된 군인은 어디로 갔을까?",
        question: "해산 군인들이 의병에 합류한 이유는 무엇일까?",
      },
    ));
    assert.equal(captured.value.data.fallbackUsed, true);
    assert.equal(captured.value.data.diagnosticCode, "ANTHROPIC_HTTP_403");
    assert.equal(captured.value.data.revisedLevelCode, "L2");
  });

  await t.test("maps every supported Anthropic HTTP status without exposing its body", async () => {
    for (const status of [400, 401, 403, 404, 429, 500, 504, 529]) {
      let fetchCalls = 0;
      const secretBody = `SECRET_ANTHROPIC_BODY_${status}`;
      const captured = await captureConsoleError(() => callEndpoint(async () => {
        fetchCalls += 1;
        return new Response(secretBody, { status, headers: { "retry-after": "0" } });
      }));
      const { data } = captured.value;
      assert.equal(data.diagnosticCode, `ANTHROPIC_HTTP_${status}`);
      assert.doesNotMatch(JSON.stringify(data), new RegExp(secretBody));
      assert.equal(fetchCalls, [429, 500, 504, 529].includes(status) ? 2 : 1);
      assert.equal(captured.calls.length, 1);
      assert.equal(captured.calls[0][1].httpStatus, status);
      assert.doesNotMatch(JSON.stringify(captured.calls), new RegExp(secretBody));
    }
  });

  await t.test("maps a missing API key, network error, requestId mismatch, and unknown error", async () => {
    const apiKey = env.get("ANTHROPIC_API_KEY");
    env.delete("ANTHROPIC_API_KEY");
    try {
      const missing = await captureConsoleError(() => callEndpoint(async () => {
        throw new Error("fetch must not run");
      }));
      assert.equal(missing.value.data.diagnosticCode, "ANTHROPIC_KEY_MISSING");
      assert.equal(missing.calls[0][1].httpStatus, null);
    } finally {
      env.set("ANTHROPIC_API_KEY", apiKey);
    }

    const network = await captureConsoleError(() => callEndpoint(async () => {
      throw new TypeError("private transport detail");
    }));
    assert.equal(network.value.data.diagnosticCode, "ANTHROPIC_NETWORK_ERROR");
    assert.doesNotMatch(JSON.stringify(network.calls), /private transport detail/);

    assert.deepEqual(anthropic.getAnthropicDiagnostic(new Error("REQUEST_ID_MISMATCH")), {
      diagnosticCode: "ANTHROPIC_REQUEST_ID_MISMATCH",
      httpStatus: 200,
    });
    assert.deepEqual(anthropic.getAnthropicDiagnostic(new Error("private unknown detail")), {
      diagnosticCode: "ANTHROPIC_UNKNOWN_ERROR",
      httpStatus: null,
    });
  });

  await t.test("exports only the approved diagnostic code allowlist", () => {
    assert.deepEqual([...anthropic.ANTHROPIC_DIAGNOSTIC_CODES], [
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
    ]);
  });

  await t.test("does not write the raw question to console logs", async () => {
    const rawQuestion = "해산 군인들의 행방을 자료에서 확인하면 무엇일까?";
    const sessionId = "private-session-id";
    const captured = await captureConsoleError(() => callEndpoint(
      async () => new Response("private Anthropic response", { status: 401 }),
      { question: rawQuestion, sessionId },
    ));
    assert.equal(captured.calls.length, 1);
    assert.equal(captured.calls[0][0], "question_analysis_fallback");
    assert.deepEqual(Object.keys(captured.calls[0][1]), ["requestId", "diagnosticCode", "httpStatus"]);
    assert.deepEqual(captured.calls[0][1], {
      requestId: captured.value.requestId,
      diagnosticCode: "ANTHROPIC_HTTP_401",
      httpStatus: 401,
    });
    const logged = JSON.stringify(captured.calls);
    assert.doesNotMatch(logged, new RegExp(rawQuestion));
    assert.doesNotMatch(logged, new RegExp(sessionId));
    assert.doesNotMatch(logged, /private Anthropic response|test-api-key|1907년 일제/);
  });

  await t.test("front end omits material and distinguishes server responses", async () => {
    const source = await readFile(new URL("../../../question-demo/app.js", import.meta.url), "utf8");
    const config = await readFile(new URL("../../../question-demo/config.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /material:\s*content\.material/);
    assert.match(source, /serverResponseError\("REQUEST_ID_MISMATCH"\)/);
    assert.match(source, /if \(error\?\.serverResponded\)/);
    assert.match(config, /demoMode:\s*true/);
  });
});
