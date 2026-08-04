export function normalizeQuestion(value: unknown): string {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

export function validateQuestion(question: string) {
  if (question.length < 10 || question.length > 150) return { ok: false, code: "INVALID_LENGTH" };
  if (!/[가-힣A-Za-z0-9]/.test(question)) return { ok: false, code: "EMPTY_CONTENT" };
  if (containsPersonalInfo(question)) return { ok: false, code: "PERSONAL_INFO" };
  if (/(시스템\s*프롬프트|규칙\s*무시|developer message|system prompt|ignore previous)/i.test(question)) {
    return { ok: false, code: "PROMPT_INJECTION" };
  }
  return { ok: true, code: null };
}

export function normalizeRequestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const requestId = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    ? requestId
    : null;
}

export function validateClaudeSafety(
  value: unknown,
  blockedAnswerPhrases: string[],
  question: string,
): { ok: true } | { ok: false; code: "CLAUDE_CONTAINS_ANSWER" | "CLAUDE_CONTAINS_FULL_REWRITE" | "CLAUDE_INVALID_SAFETY" } {
  if (!value || typeof value !== "object") return { ok: false, code: "CLAUDE_INVALID_SAFETY" };
  const result = value as Record<string, unknown>;
  const safety = result.safety;
  if (!safety || typeof safety !== "object") return { ok: false, code: "CLAUDE_INVALID_SAFETY" };
  const flags = safety as Record<string, unknown>;
  if (typeof flags.containsAnswer !== "boolean" || typeof flags.containsFullRewrite !== "boolean") {
    return { ok: false, code: "CLAUDE_INVALID_SAFETY" };
  }
  if (flags.containsAnswer) return { ok: false, code: "CLAUDE_CONTAINS_ANSWER" };
  if (flags.containsFullRewrite) return { ok: false, code: "CLAUDE_CONTAINS_FULL_REWRITE" };
  if (!isSafeRewriteHint(result.rewriteHint, question)) {
    return { ok: false, code: "CLAUDE_CONTAINS_FULL_REWRITE" };
  }

  const textFields = [result.strength, result.nextStep, result.rewriteHint, result.comparison]
    .filter((item): item is string => typeof item === "string");
  const combined = normalizeForSafety(textFields.join(" "));
  if (blockedAnswerPhrases.some((phrase) => combined.includes(normalizeForSafety(phrase)))) {
    return { ok: false, code: "CLAUDE_CONTAINS_ANSWER" };
  }
  if (textFields.some((text) => /[?？][\s"'’”)]*$/.test(text.trim()))) {
    return { ok: false, code: "CLAUDE_CONTAINS_FULL_REWRITE" };
  }
  return { ok: true };
}

export function isSafeRewriteHint(value: unknown, question: string): boolean {
  if (typeof value !== "string") return false;
  const hint = value.trim();
  if (!hint || hint.length > 40) return false;
  if (/[?？.!！。\r\n;；,，/|]/.test(hint)) return false;
  if (/["'“”‘’]/.test(hint)) return false;

  const parts = hint.split(" · ");
  if (parts.length < 1 || parts.length > 3 || parts.join(" · ") !== hint) return false;
  if (parts.some((part) => !part.trim() || part !== part.trim() || part.length > 24 || part.includes("·"))) return false;

  const sentenceEnding = /(?:무엇인가|어떻게\s*달라졌는가|했는가|하는가|였는가|었는가|았는가|는가|인가|는지|인지|일까|을까|할까|까요|나요|가요|습니까|합니다|됩니다|하세요|보세요|하였다|했다|된다|이다|있다|없다|다|요)$/;
  if (parts.some((part) => sentenceEnding.test(part))) return false;
  if (isQuestionCopy(hint, question)) return false;
  return true;
}

function containsPersonalInfo(value: string) {
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phone = /(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/;
  const explicit = /(내\s*이름은|제\s*이름은|학교는\s*\S+학교|학번은\s*\d+)/;
  return email.test(value) || phone.test(value) || explicit.test(value);
}

function normalizeForSafety(value: string) {
  return value.replace(/\s+/g, "").replace(/[“”‘’"']/g, "").toLowerCase();
}

function isQuestionCopy(hint: string, question: string) {
  const normalizedHint = normalizeForSimilarity(hint);
  const normalizedQuestion = normalizeForSimilarity(question);
  if (!normalizedHint || !normalizedQuestion) return false;
  if (normalizedHint === normalizedQuestion) return true;
  const shorter = Math.min(normalizedHint.length, normalizedQuestion.length);
  const longer = Math.max(normalizedHint.length, normalizedQuestion.length);
  if (shorter >= 8
    && longer / shorter <= 1.35
    && (normalizedHint.includes(normalizedQuestion) || normalizedQuestion.includes(normalizedHint))) return true;
  if (shorter < 8 || longer / shorter > 1.35) return false;
  return editDistance(normalizedHint, normalizedQuestion) / longer <= 0.3;
}

function normalizeForSimilarity(value: string) {
  return value.replace(/\s+/g, "").replace(/[?？!.！。,，·'"“”‘’]/g, "").toLowerCase();
}

function editDistance(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

export async function sessionHash(sessionId: string): Promise<string> {
  const secret = Deno.env.get("SESSION_HASH_SECRET") ?? "local-development-only";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sessionId));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
