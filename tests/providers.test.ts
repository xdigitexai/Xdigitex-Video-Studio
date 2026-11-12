import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/test-db";
import { ADAPTERS, providerCodes } from "../lib/server/providers";
import { CAPABILITIES, type AdapterContext, type SourceMedia } from "../lib/server/providers/types";

function context(handler: (url: string, init: RequestInit) => Response | Promise<Response>): AdapterContext {
  return {
    baseUrl: "https://provider.test",
    credentials: { apiKey: "sk-test-key", apiSecret: "secret-test" },
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), init ?? {})) as typeof fetch,
  };
}

function imageSource(): SourceMedia {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  return {
    fileName: "source.png",
    contentType: "image/png",
    byteSize: bytes.length,
    async bytes() {
      return bytes;
    },
    async stream() {
      return new Blob([bytes]).stream();
    },
  };
}

test("every adapter only declares capabilities from the shared contract", () => {
  for (const code of providerCodes()) {
    const adapter = ADAPTERS[code];
    assert.ok(adapter.capabilities.length > 0, `${code} declares no capabilities`);
    for (const capability of adapter.capabilities) {
      assert.ok((CAPABILITIES as readonly string[]).includes(capability), `${code} has an unknown capability`);
    }
  }
});

test("every seeded model capability is actually implemented by its provider adapter", async () => {
  const db = createTestDb();
  const rows = await db.all<{ provider: string; display_name: string; capabilities: string }>(
    `SELECT p.code AS provider, m.display_name, m.capabilities
     FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id
     WHERE m.is_active = 1`,
  );
  assert.ok(rows.length >= 10);
  for (const row of rows) {
    const adapter = ADAPTERS[row.provider];
    assert.ok(adapter, `${row.provider} has no adapter`);
    const declared = JSON.parse(row.capabilities) as string[];
    for (const capability of declared) {
      assert.ok(
        adapter.capabilities.includes(capability as never),
        `${row.display_name} sells ${capability} but the ${row.provider} adapter does not implement it`,
      );
    }
  }
});

test("Runway submits the documented image_to_video request", async () => {
  let captured: { url: string; body: Record<string, unknown>; headers: Headers } | null = null;
  const ctx = context((url, init) => {
    captured = {
      url,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      headers: new Headers(init.headers),
    };
    return new Response(JSON.stringify({ id: "task_runway_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const result = await ADAPTERS.runway.submit(ctx, {
    modelCode: "gen4.5",
    capability: "text_to_video",
    prompt: "Waves at golden hour",
    durationSeconds: 5,
    aspect: "16:9",
  });
  assert.equal(result.externalId, "task_runway_1");
  assert.match(captured!.url, /\/v1\/image_to_video$/);
  assert.equal(captured!.headers.get("X-Runway-Version"), "2024-11-06");
  assert.equal(captured!.headers.get("authorization"), "Bearer sk-test-key");
  assert.equal(captured!.body.model, "gen4.5");
  assert.equal(captured!.body.ratio, "1280:720");
  assert.equal(captured!.body.duration, 5);
});

test("Runway polls task status and maps outputs", async () => {
  const ctx = context((url) => {
    assert.match(url, /\/v1\/tasks\/task_runway_1$/);
    return new Response(
      JSON.stringify({ status: "SUCCEEDED", progress: 1, output: ["https://cdn.test/clip.mp4"] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const status = await ADAPTERS.runway.getStatus(ctx, "task_runway_1");
  assert.equal(status.state, "succeeded");
  assert.equal(status.outputs?.[0].contentType, "video/mp4");
});

test("OpenAI image generation returns an immediate image result", async () => {
  const ctx = context((url, init) => {
    assert.match(url, /\/v1\/images\/generations$/);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    assert.equal(body.model, "gpt-image-1");
    assert.equal(body.size, "1536x1024");
    return new Response(JSON.stringify({ data: [{ b64_json: "YWJj" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const result = await ADAPTERS.openai.submit(ctx, {
    modelCode: "gpt-image-1",
    capability: "text_to_image",
    prompt: "A poster",
    aspect: "16:9",
    imageCount: 1,
  });
  assert.equal(result.immediateResult?.state, "succeeded");
  assert.equal(result.immediateResult?.outputs?.[0].base64, "YWJj");
  assert.equal(result.immediateResult?.outputs?.[0].contentType, "image/png");
});

test("Gemini returns inline image data", async () => {
  const ctx = context((url) => {
    assert.match(url, /generateContent\?key=sk-test-key$/);
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "YWJj" } }] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const result = await ADAPTERS.google.submit(ctx, {
    modelCode: "gemini-2.5-flash-image",
    capability: "text_to_image",
    prompt: "A poster",
  });
  assert.equal(result.immediateResult?.outputs?.[0].base64, "YWJj");
});

test("DeepSeek returns enhanced prompt text", async () => {
  const ctx = context((url, init) => {
    assert.match(url, /\/chat\/completions$/);
    const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
    assert.ok(body.messages.length === 2);
    return new Response(JSON.stringify({ choices: [{ message: { content: "A cinematic prompt" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const result = await ADAPTERS.deepseek.enhancePrompt!(ctx, { modelCode: "deepseek-chat", prompt: "ocean" });
  assert.equal(result.text, "A cinematic prompt");
});

test("Kling signs a JWT and submits image-to-video", async () => {
  let authorization = "";
  let body: Record<string, unknown> = {};
  const ctx = context((url, init) => {
    assert.match(url, /\/v1\/videos\/image2video$/);
    authorization = new Headers(init.headers).get("authorization") ?? "";
    body = JSON.parse(String(init.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ code: 0, message: "SUCCEED", data: { task_id: "kling_1" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const result = await ADAPTERS.kling.submit(ctx, {
    modelCode: "kling-v2-master",
    capability: "image_to_video",
    prompt: "Camera orbit",
    durationSeconds: 5,
    source: imageSource(),
  });
  assert.equal(result.externalId, "kling_1");
  assert.match(authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
  const payload = JSON.parse(
    Buffer.from(authorization.split(" ")[1].split(".")[1], "base64url").toString("utf8"),
  ) as { iss: string };
  assert.equal(payload.iss, "sk-test-key");
  assert.equal(body.model_name, "kling-v2-master");
  assert.equal(body.image, "AQIDBA==");
});

test("Replicate maps prediction output URLs", async () => {
  const ctx = context((url) => {
    assert.match(url, /\/v1\/predictions\/pred_1$/);
    return new Response(JSON.stringify({ status: "succeeded", output: ["https://cdn.test/image.png"] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const status = await ADAPTERS.replicate.getStatus(ctx, "pred_1");
  assert.equal(status.state, "succeeded");
  assert.equal(status.outputs?.[0].url, "https://cdn.test/image.png");
});

test("provider errors never leak the API key", async () => {
  const ctx = context(() =>
    new Response(JSON.stringify({ error: { message: "bad key" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  );
  await assert.rejects(
    ADAPTERS.openai.submit(ctx, {
      modelCode: "gpt-image-1",
      capability: "text_to_image",
      prompt: "poster",
    }),
    (error: unknown) => {
      const text = JSON.stringify({
        message: error instanceof Error ? error.message : error,
        detail: (error as { detail?: string }).detail,
      });
      assert.ok(!text.includes("sk-test-key"));
      return true;
    },
  );
});
