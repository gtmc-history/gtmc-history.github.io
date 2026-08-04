import {
  type DashboardGuardResult,
  dashboardJson,
  guardDashboardRequest,
} from "./dashboard-security.ts";

const ALLOWED_ORIGIN = "https://dashboard.example.test";
const DISALLOWED_ORIGIN = "https://untrusted.example.test";

Deno.test("허용 origin과 올바른 토큰을 승인한다", async () => {
  await withDashboardEnv(crypto.randomUUID(), ALLOWED_ORIGIN, async (token) => {
    const result = await guard("GET", ALLOWED_ORIGIN, token);
    assert(result.ok, "request should be authorized");

    if (result.ok) {
      const response = dashboardJson({ ok: true }, 200, result.headers);
      assertEquals(response.status, 200);
      assertEquals(
        response.headers.get("Access-Control-Allow-Origin"),
        ALLOWED_ORIGIN,
      );
      assertEquals(response.headers.get("Cache-Control"), "no-store");
    }
  });
});

Deno.test("허용 origin과 잘못된 토큰을 401로 거부한다", async () => {
  await withDashboardEnv(crypto.randomUUID(), ALLOWED_ORIGIN, async (token) => {
    const response = requireResponse(
      await guard("GET", ALLOWED_ORIGIN, `${token}-invalid`),
    );
    assertEquals(response.status, 401);
    assertEquals(
      response.headers.get("Access-Control-Allow-Origin"),
      ALLOWED_ORIGIN,
    );
    assertEquals(response.headers.get("Cache-Control"), "no-store");
  });
});

Deno.test("허용 origin의 토큰 누락을 401로 거부한다", async () => {
  await withDashboardEnv(crypto.randomUUID(), ALLOWED_ORIGIN, async () => {
    const response = requireResponse(await guard("GET", ALLOWED_ORIGIN));
    assertEquals(response.status, 401);
    assertEquals(
      response.headers.get("Access-Control-Allow-Origin"),
      ALLOWED_ORIGIN,
    );
  });
});

Deno.test("허용되지 않은 origin을 403으로 거부한다", async () => {
  await withDashboardEnv(crypto.randomUUID(), ALLOWED_ORIGIN, async (token) => {
    const response = requireResponse(
      await guard("GET", DISALLOWED_ORIGIN, token),
    );
    assertEquals(response.status, 403);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
    assertEquals(response.headers.get("Cache-Control"), "no-store");
  });
});

Deno.test("Origin 헤더 누락을 403으로 거부한다", async () => {
  await withDashboardEnv(crypto.randomUUID(), ALLOWED_ORIGIN, async (token) => {
    const response = requireResponse(await guard("GET", undefined, token));
    assertEquals(response.status, 403);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
  });
});

Deno.test("허용 origin의 OPTIONS를 204로 처리한다", async () => {
  await withDashboardEnv(crypto.randomUUID(), ALLOWED_ORIGIN, async () => {
    const response = requireResponse(
      await guard("OPTIONS", ALLOWED_ORIGIN),
    );
    assertEquals(response.status, 204);
    assertEquals(
      response.headers.get("Access-Control-Allow-Origin"),
      ALLOWED_ORIGIN,
    );
    assertEquals(response.headers.get("Cache-Control"), "no-store");
  });
});

Deno.test("허용되지 않은 origin의 OPTIONS를 403으로 거부한다", async () => {
  await withDashboardEnv(crypto.randomUUID(), ALLOWED_ORIGIN, async () => {
    const response = requireResponse(
      await guard("OPTIONS", DISALLOWED_ORIGIN),
    );
    assertEquals(response.status, 403);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
  });
});

Deno.test("DASHBOARD_TOKEN 환경변수 누락 시 503으로 실패한다", async () => {
  await withDashboardEnv(undefined, ALLOWED_ORIGIN, async () => {
    const response = requireResponse(await guard("GET", ALLOWED_ORIGIN));
    assertEquals(response.status, 503);
    assertEquals(
      response.headers.get("Access-Control-Allow-Origin"),
      ALLOWED_ORIGIN,
    );
  });
});

Deno.test("ALLOWED_ORIGINS 환경변수 누락 시 503으로 실패한다", async () => {
  await withDashboardEnv(crypto.randomUUID(), undefined, async (token) => {
    const response = requireResponse(await guard("GET", ALLOWED_ORIGIN, token));
    assertEquals(response.status, 503);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
  });
});

async function guard(
  method: string,
  origin?: string,
  token?: string,
): Promise<DashboardGuardResult> {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (token) headers.set("x-dashboard-token", token);
  return await guardDashboardRequest(
    new Request("https://edge.example.test/dashboard", { method, headers }),
    ["GET"],
  );
}

function requireResponse(result: DashboardGuardResult) {
  if (result.ok) throw new Error("expected request to be rejected");
  assertEquals(result.response.headers.get("Cache-Control"), "no-store");
  return result.response;
}

async function withDashboardEnv(
  token: string | undefined,
  allowedOrigins: string | undefined,
  run: (token: string | undefined) => Promise<void>,
) {
  const previousToken = Deno.env.get("DASHBOARD_TOKEN");
  const previousOrigins = Deno.env.get("ALLOWED_ORIGINS");

  setEnv("DASHBOARD_TOKEN", token);
  setEnv("ALLOWED_ORIGINS", allowedOrigins);

  try {
    await run(token);
  } finally {
    setEnv("DASHBOARD_TOKEN", previousToken);
    setEnv("ALLOWED_ORIGINS", previousOrigins);
  }
}

function setEnv(name: string, value?: string) {
  if (value === undefined) Deno.env.delete(name);
  else Deno.env.set(name, value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`expected ${String(expected)}, received ${String(actual)}`);
  }
}
