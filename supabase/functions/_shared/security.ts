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

function containsPersonalInfo(value: string) {
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phone = /(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/;
  const explicit = /(내\s*이름은|제\s*이름은|학교는\s*\S+학교|학번은\s*\d+)/;
  return email.test(value) || phone.test(value) || explicit.test(value);
}

function normalizeForSafety(value: string) {
  return value.replace(/\s+/g, "").replace(/[“”‘’"']/g, "").toLowerCase();
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
