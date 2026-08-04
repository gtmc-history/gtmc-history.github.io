import { getCorsHeaders } from "../_shared/cors.ts";
import { analyzeByRules, detectChanges, fallbackComparison } from "../_shared/rules.ts";
import { normalizeQuestion, sessionHash, validateQuestion } from "../_shared/security.ts";
import { createComparison, createInitialFeedback } from "../_shared/anthropic.ts";
import { consumeRateLimit, insertEvent } from "../_shared/db.ts";

const MAX_TOTAL_MS = 9000;
const CLAUDE_TIMEOUT_MS = Number(Deno.env.get("CLAUDE_TIMEOUT_MS") ?? 7000);

export default {
  async fetch(req: Request) {
    const { permitted, headers: corsHeaders } = getCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (!permitted) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403, corsHeaders);
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, corsHeaders);

    const startedAt = Date.now();
    let requestId = crypto.randomUUID();
    try {
      const body = await req.json();
      requestId = typeof body.requestId === "string" ? body.requestId : requestId;
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      const stage = body.stage === "revision" ? "revision" : "initial";
      const question = normalizeQuestion(body.question);
      const originalQuestion = normalizeQuestion(body.originalQuestion);
      const material = normalizeQuestion(body.material).slice(0, 1000);
      const source = ["expo2026", "conference2026", "direct"].includes(body.source) ? body.source : "direct";
      const contentId = String(body.contentId ?? "unknown").slice(0, 80);

      const validation = validateQuestion(question);
      if (!validation.ok) return json({ requestId, error: validation.code }, 400, corsHeaders);
      if (stage === "revision") {
        const originalValidation = validateQuestion(originalQuestion);
        if (!originalValidation.ok) return json({ requestId, error: "INVALID_ORIGINAL" }, 400, corsHeaders);
        if (normalizeQuestion(question) === normalizeQuestion(originalQuestion)) return json({ requestId, error: "NO_CHANGE" }, 400, corsHeaders);
      }

      const hash = await sessionHash(sessionId || requestId);
      const allowed = await consumeRateLimit(`${hash}:${stage}`, 4, 600);
      if (!allowed) return json({ requestId, error: "RATE_LIMITED" }, 429, corsHeaders);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(CLAUDE_TIMEOUT_MS, MAX_TOTAL_MS - 500));
      let fallbackUsed = false;
      let result;

      try {
        if (stage === "initial") {
          const rules = analyzeByRules(question);
          const ai = await withOneRetry(() => createInitialFeedback({ material, question, ...rules }, controller.signal));
          result = {
            requestId,
            levelCode: rules.levelCode,
            levelLabel: rules.levelLabel,
            strength: clip(ai.strength, 90) || rules.fallback.strength,
            nextStep: clip(ai.nextStep, 100) || rules.fallback.nextStep,
            rewriteHint: rejectCompleteQuestion(clip(ai.rewriteHint, 100)) || rules.fallback.rewriteHint,
            fallbackUsed: false
          };
        } else {
          const before = analyzeByRules(originalQuestion);
          const after = analyzeByRules(question);
          const changeTags = detectChanges(originalQuestion, question);
          const ai = await withOneRetry(() => createComparison({
            material,
            originalQuestion,
            revisedQuestion: question,
            initialLevelCode: before.levelCode,
            revisedLevelCode: after.levelCode,
            changeTags
          }, controller.signal));
          result = {
            requestId,
            initialLevelCode: before.levelCode,
            initialLevelLabel: before.levelLabel,
            revisedLevelCode: after.levelCode,
            revisedLevelLabel: after.levelLabel,
            changeTags: changeTags.length ? changeTags : ["표현 정리"],
            comparison: clip(ai.comparison, 180),
            nextTry: rejectCompleteQuestion(clip(ai.nextTry, 100)),
            fallbackUsed: false
          };
        }
      } catch (error) {
        fallbackUsed = true;
        console.error(JSON.stringify({ requestId, errorCode: safeErrorCode(error) }));
        if (stage === "initial") {
          const rules = analyzeByRules(question);
          result = { requestId, levelCode: rules.levelCode, levelLabel: rules.levelLabel, ...rules.fallback, fallbackUsed: true };
        } else {
          result = { requestId, ...fallbackComparison(originalQuestion, question), fallbackUsed: true };
        }
      } finally {
        clearTimeout(timer);
      }

      await insertEvent({
        session_hash: hash,
        source,
        event_type: stage === "initial" ? "initial_feedback_shown" : "comparison_shown",
        content_id: contentId,
        prompt_version: "question-demo-v1.0",
        initial_level: stage === "initial" ? result.levelCode : result.initialLevelCode,
        revised_level: stage === "revision" ? result.revisedLevelCode : null,
        processing_ms: Date.now() - startedAt,
        fallback_used: fallbackUsed,
        error_code: null
      });

      return json(result, 200, corsHeaders);
    } catch (error) {
      console.error(JSON.stringify({ requestId, errorCode: safeErrorCode(error) }));
      return json({ requestId, error: "INTERNAL_ERROR" }, 500, corsHeaders);
    }
  }
};

async function withOneRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (![429, 500, 529].includes(status ?? 0)) throw error;
    const retryAfter = Number((error as { retryAfter?: string }).retryAfter ?? 0);
    await new Promise((resolve) => setTimeout(resolve, Math.min(700, Math.max(250, retryAfter * 1000))));
    return await operation();
  }
}

function rejectCompleteQuestion(value: string) {
  if (!value) return "";
  const looksLikeQuestion = /[?？]$/.test(value.trim()) || /^(왜|어떻게|무엇|어떤|누가|언제)/.test(value.trim());
  return looksLikeQuestion ? "대상 · 시기 · 조건 · 관점 중 한 요소를 골라 보완해 보세요." : value;
}
function clip(value: unknown, max: number) { return String(value ?? "").trim().slice(0, max); }
function safeErrorCode(error: unknown) { return error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN"; }
function json(data: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
