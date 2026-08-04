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
import { analyzeWithClaude, type ClaudeAnalysis } from "../_shared/anthropic.ts";
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
      let fallbackReason: string | null = null;
      let result: Record<string, unknown>;
      try {
        const ai = await analyzeWithClaude({
          stage,
          material: content.material,
          question,
          originalQuestion: stage === "revision" ? originalQuestion : undefined,
        });
        const safety = validateClaudeSafety(ai, content.blockedAnswerPhrases);
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
            nextTry: clip(ai.rewriteHint, 120),
            fallbackUsed: false,
          };
        }
      } catch (error) {
        fallbackUsed = true;
        fallbackReason = safeErrorCode(error);
        console.error(JSON.stringify({ requestId, errorCode: fallbackReason }));
        if (stage === "initial") {
          const rules = analyzeByRules(question, content);
          result = {
            requestId,
            ruleEngine: PROVISIONAL_RULE_ENGINE_ID,
            levelCode: rules.levelCode,
            levelLabel: rules.levelLabel,
            features: rules.features,
            ...rules.fallback,
            changeTags: [],
            comparison: "",
            safety: { containsAnswer: false, containsFullRewrite: false },
            fallbackUsed: true,
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
            safety: { containsAnswer: false, containsFullRewrite: false },
            ...comparison,
            initialLevelCode: before.levelCode,
            initialLevelLabel: before.levelLabel,
            revisedLevelCode: after.levelCode,
            revisedLevelLabel: after.levelLabel,
            fallbackUsed: true,
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
        error_code: fallbackReason,
      });

      return json(result, 200, corsHeaders);
    } catch (error) {
      console.error(JSON.stringify({ requestId, errorCode: safeErrorCode(error) }));
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
    rewriteHint: clip(ai.rewriteHint, 120),
    changeTags: ai.changeTags.map((tag) => clip(tag, 30)).filter(Boolean).slice(0, 4),
    comparison: clip(ai.comparison, 240),
    safety: ai.safety,
  };
}

function clip(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  return /^[A-Z0-9_]+$/.test(message) ? message.slice(0, 80) : "CLAUDE_FAILURE";
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
