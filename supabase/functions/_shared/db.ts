export async function insertEvent(row: Record<string, unknown>) {
  if ((Deno.env.get("EVENT_LOGGING_ENABLED") ?? "false") !== "true") return;
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return;
  await fetch(`${url}/rest/v1/question_demo_events`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "return=minimal"
    },
    body: JSON.stringify(row)
  });
}

export async function consumeRateLimit(bucketKey: string, limit: number, windowSeconds: number): Promise<boolean> {
  if ((Deno.env.get("RATE_LIMIT_ENABLED") ?? "false") !== "true") return true;
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return true;
  const response = await fetch(`${url}/rest/v1/rpc/consume_question_demo_limit`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ p_bucket_key: bucketKey, p_limit: limit, p_window_seconds: windowSeconds })
  });
  if (!response.ok) return true;
  return Boolean(await response.json());
}
