import { describe, expect, it, vi } from "vitest";
import { MealPrepWorkflow } from "../src/workflow";

const createStepStub = () => {
  return {
    do: vi.fn(async (_name: string, handler: () => Promise<unknown>) => {
      return handler();
    }),
    sleep: vi.fn(async () => Promise.resolve())
  };
};

describe("MealPrepWorkflow", () => {
  it("runs weekly meal prep workflow", async () => {
    const workflow = Object.create(
      MealPrepWorkflow.prototype
    ) as MealPrepWorkflow;
    // @ts-expect-error env is assigned manually for test
    workflow.env = {} as Env;

    const step = createStepStub();
    const payload = {
      type: "weekly_meal_prep" as const,
      userId: "user_123",
      profileSnapshot: null,
      weekOf: "2025-10-13"
    };

    const result = await workflow.run.call(
      workflow,
      { payload } as any,
      step as any
    );

    expect(result.status).toBe("completed");
    expect(result.events.length).toBeGreaterThan(0);
  });
});
