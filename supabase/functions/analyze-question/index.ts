import { getCorsHeaders } from "../_shared/cors.ts";
import {
  analyzeByRules,
  fallbackComparison,
  getQuestionContent,
  PROVISIONAL_RULE_ENGINE_ID,
} from "../_shared/rules.ts";
import {
  normalizeQuestion,
  normalizeRequestId,
  sessionHash,
  validateClaudeSafety,
  validateQuestion,
} from "../_shared/security.ts";
import {
  analyzeWithClaude,
  getAnthropicDiagnostic,
  type AnthropicDiagnosticCode,
  type ClaudeAnalysis,
} from "../_shared/anthropic.ts";
import { consumeRateLimit, insertEvent } from "../_shared/db.ts";

export default {
  async fetch(req: Request) {
    const { permitted, headers: corsHeaders } = getCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (!permitted) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403, corsHeaders);
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, corsHeaders);

    const startedAt = Date.now();
    let requestId = "";
    try {
      const body = await req.json();
      const rawRequestId = typeof body.requestId === "string" ? body.requestId.slice(0, 80) : "";
      requestId = normalizeRequestId(rawRequestId) ?? rawRequestId;
      if (!normalizeRequestId(rawRequestId)) {
        return json({ requestId, error: "INVALID_REQUEST_ID" }, 400, corsHeaders);
      }

      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      const stage = body.stage === "revision" ? "revision" : "initial";
      const question = normalizeQuestion(body.question);
      const originalQuestion = normalizeQuestion(body.originalQuestion);
      const source = ["expo2026", "conference2026", "direct"].includes(body.source) ? body.source : "direct";
      const contentId = String(body.contentId ?? "").slice(0, 80);
      const content = getQuestionContent(contentId);
      if (!content) return json({ requestId, error: "UNKNOWN_CONTENT" }, 400, corsHeaders);

      const validation = validateQuestion(question);
      if (!validation.ok) return json({ requestId, error: validation.code }, 400, corsHeaders);
      if (stage === "revision") {
        const originalValidation = validateQuestion(originalQuestion);
        if (!originalValidation.ok) return json({ requestId, error: "INVALID_ORIGINAL" }, 400, corsHeaders);
        if (question === originalQuestion) return json({ requestId, error: "NO_CHANGE" }, 400, corsHeaders);
      }

      const hash = await sessionHash(sessionId || requestId);
      const allowed = await consumeRateLimit(`${hash}:${stage}`, 4, 600);
      if (!allowed) return json({ requestId, error: "RATE_LIMITED" }, 429, corsHeaders);

      let fallbackUsed = false;
      let diagnosticCode: AnthropicDiagnosticCode | null = null;
      let result: Record<string, unknown>;
      try {
        const ai = await analyzeWithClaude({
          stage,
          material: content.material,
          question,
          originalQuestion: stage === "revision" ? originalQuestion : undefined,
        });
        const safety = validateClaudeSafety(ai, content.blockedAnswerPhrases, question);
        if (!safety.ok) throw new Error(safety.code);

        if (stage === "initial") {
          result = {
            requestId,
            ...clipAnalysis(ai),
            fallbackUsed: false,
          };
        } else {
          const before = analyzeByRules(originalQuestion, content);
          result = {
            requestId,
            ...clipAnalysis(ai),
            initialLevelCode: before.levelCode,
            initialLevelLabel: before.levelLabel,
            revisedLevelCode: ai.levelCode,
            revisedLevelLabel: ai.levelLabel,
            nextTry: clip(ai.rewriteHint, 40),
            fallbackUsed: false,
          };
        }
      } catch (error) {
        fallbackUsed = true;
        const diagnostic = getAnthropicDiagnostic(error);
        diagnosticCode = diagnostic.diagnosticCode;
        console.error("question_analysis_fallback", {
          requestId,
          diagnosticCode,
          httpStatus: diagnostic.httpStatus,
        });
        if (stage === "initial") {
          const rules = analyzeByRules(question, content);
          result = {
            requestId,
            ruleEngine: PROVISIONAL_RULE_ENGINE_ID,
            levelCode: rules.levelCode,
            levelLabel: rules.levelLabel,
            features: rules.features,
            ...rules.fallback,
            rewriteHint: fallbackRewriteHint(rules.levelCode),
            changeTags: [],
            comparison: "",
            safety: { containsAnswer: false, containsFullRewrite: false },
            fallbackUsed: true,
            diagnosticCode,
          };
        } else {
          const before = analyzeByRules(originalQuestion, content);
          const after = analyzeByRules(question, content);
          const comparison = fallbackComparison(originalQuestion, question, content);
          result = {
            requestId,
            ruleEngine: PROVISIONAL_RULE_ENGINE_ID,
            levelCode: after.levelCode,
            levelLabel: after.levelLabel,
            features: after.features,
            ...after.fallback,
            rewriteHint: fallbackRewriteHint(after.levelCode),
            safety: { containsAnswer: false, containsFullRewrite: false },
            ...comparison,
            initialLevelCode: before.levelCode,
            initialLevelLabel: before.levelLabel,
            revisedLevelCode: after.levelCode,
            revisedLevelLabel: after.levelLabel,
            fallbackUsed: true,
            diagnosticCode,
          };
        }
      }

      await insertEvent({
        session_hash: hash,
        source,
        event_type: stage === "initial" ? "initial_feedback_shown" : "comparison_shown",
        content_id: contentId,
        prompt_version: "question-demo-claude-v1",
        initial_level: stage === "initial" ? result.levelCode : result.initialLevelCode,
        revised_level: stage === "revision" ? result.revisedLevelCode : null,
        processing_ms: Date.now() - startedAt,
        fallback_used: fallbackUsed,
        error_code: diagnosticCode,
      });

      return json(result, 200, corsHeaders);
    } catch {
      return json({ requestId, error: "INTERNAL_ERROR" }, 500, corsHeaders);
    }
  },
};

function clipAnalysis(ai: ClaudeAnalysis) {
  return {
    levelCode: ai.levelCode,
    levelLabel: ai.levelLabel,
    features: ai.features,
    strength: clip(ai.strength, 120),
    nextStep: clip(ai.nextStep, 140),
    rewriteHint: clip(ai.rewriteHint, 40),
    changeTags: ai.changeTags.map((tag) => clip(tag, 30)).filter(Boolean).slice(0, 4),
    comparison: clip(ai.comparison, 240),
    safety: ai.safety,
  };
}

function fallbackRewriteHint(levelCode: string) {
  const hints: Record<string, string> = {
    L1: "합류 이유 · 합류 이후의 변화",
    L2: "행위자 · 조건 · 영향 범위",
    L3: "비교 기준 · 자료 근거 · 관점",
  };
  return hints[levelCode] ?? hints.L1;
}

function clip(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function json(data: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
