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

function containsPersonalInfo(value: string) {
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phone = /(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/;
  const explicit = /(내\s*이름은|제\s*이름은|학교는\s*\S+학교|학번은\s*\d+)/;
  return email.test(value) || phone.test(value) || explicit.test(value);
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
