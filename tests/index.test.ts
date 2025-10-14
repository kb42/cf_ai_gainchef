import {
  env,
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
// Could import any other source file/function here
import worker from "../src/server";

declare module "cloudflare:test" {
  // Controls the type of `import("cloudflare:test").env`
  interface ProvidedEnv extends Env {}
}

describe("GainChef worker", () => {
  it("responds with Not found for unknown routes", async () => {
    const request = new Request("http://example.com");
    // Create an empty context to pass to `worker.fetch()`
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    // Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
    await waitOnExecutionContext(ctx);
    expect(await response.text()).toBe("Not found");
    expect(response.status).toBe(404);
  });

  it("returns health information", async () => {
    const request = new Request("http://example.com/health");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("ok");
    expect(typeof payload.timestamp).toBe("string");
  });

  it("queues a workflow run", async () => {
    const createStub = vi.fn(async () => ({ id: "wf_test" }));
    const localEnv: Env = {
      ...env,
      MEAL_PREP: {
        create: createStub
      } as unknown as Env["MEAL_PREP"]
    };

    const request = new Request("http://example.com/trigger-workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "daily_macro_check",
        userId: "user_demo",
        profileSnapshot: null,
        date: "2025-10-13"
      })
    });

    const ctx = createExecutionContext();
    const response = await worker.fetch(request, localEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(payload.workflowId).toBe("wf_test");
    expect(createStub).toHaveBeenCalledTimes(1);
  });
});
