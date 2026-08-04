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

const [{ default: handler }, rules, anthropic] = await Promise.all([
  import("./index.ts"),
  import("../_shared/rules.ts"),
  import("../_shared/anthropic.ts"),
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
    rewriteHint: "선택 이유 또는 이후 영향",
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
    for (const field of ["levelCode", "levelLabel", "features", "strength", "nextStep", "rewriteHint", "changeTags", "comparison", "safety"]) {
      assert.ok(Object.hasOwn(result.data, field), field);
    }
    assert.equal(sentBody.model, anthropic.CLAUDE_MODEL_ID);
    assert.equal(sentBody.model, "claude-haiku-4-5-20251001");
    assert.equal(sentBody.output_config.format.type, "json_schema");
    assert.deepEqual(sentBody.output_config.format.schema, anthropic.CLAUDE_OUTPUT_SCHEMA);
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
  });

  await t.test("blocks an historical answer", async () => {
    const result = await callEndpoint(async () => claudeResponse(claudeOutput({
      strength: "해산 군인 일부는 무기를 들고 의병에 합류하였다.",
    })));
    assert.equal(result.data.fallbackUsed, true);
    assert.equal(result.data.safety.containsAnswer, false);
  });

  await t.test("invalid Claude JSON falls back", async () => {
    const result = await callEndpoint(async () => new Response(JSON.stringify({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "{invalid-json" }],
    }), { status: 200 }));
    assert.equal(result.data.fallbackUsed, true);
    assert.equal(result.data.levelCode, "L1");
  });

  await t.test("aborts Claude at seven seconds and falls back", async () => {
    const startedAt = Date.now();
    const result = await callEndpoint((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const elapsed = Date.now() - startedAt;
    assert.equal(result.data.fallbackUsed, true);
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
  });

  await t.test("does not write the raw question to console logs", async () => {
    const rawQuestion = "해산 군인들의 행방을 자료에서 확인하면 무엇일까?";
    const captured = [];
    const originalError = console.error;
    console.error = (...args) => captured.push(args.join(" "));
    try {
      await callEndpoint(async () => new Response("unauthorized", { status: 401 }), { question: rawQuestion });
    } finally {
      console.error = originalError;
    }
    assert.ok(captured.length > 0);
    assert.doesNotMatch(captured.join("\n"), new RegExp(rawQuestion));
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
