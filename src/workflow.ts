import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep
} from "cloudflare:workers";
import type { WorkflowPayload } from "./types";

interface WorkflowResult {
  status: "completed";
  events: Array<{
    name: string;
    note: string;
    timestamp: number;
  }>;
}

export class MealPrepWorkflow extends WorkflowEntrypoint<Env, WorkflowPayload> {
  async run(
    event: WorkflowEvent<WorkflowPayload>,
    step: WorkflowStep
  ): Promise<WorkflowResult> {
    const payload = event.payload;
    const events: WorkflowResult["events"] = [];

    const record = (name: string, note: string) => {
      const entry = { name, note, timestamp: Date.now() };
      events.push(entry);
      return entry;
    };

    if (payload.type === "weekly_meal_prep") {
      await step.do("prep-profile", async () => {
        record(
          "profile-snapshot",
          `Loaded profile for ${payload.userId} to build weekly plan`
        );
      });

      await step.do("generate-plan", async () => {
        record(
          "plan-generated",
          `Generated weekly plan for week of ${payload.weekOf}`
        );
      });

      await step.do("queue-reminders", async () => {
        record(
          "reminders-scheduled",
          "Scheduled reminders for grocery shopping and prep"
        );
      });
    }

    if (payload.type === "daily_macro_check") {
      await step.do("aggregate-metrics", async () => {
        record(
          "macros-calculated",
          `Compiled macro totals for ${payload.date}`
        );
      });

      await step.do("send-summary", async () => {
        record(
          "summary-sent",
          `Queued daily progress message for ${payload.userId}`
        );
      });
    }

    if (payload.type === "monthly_report") {
      await step.do("gather-history", async () => {
        record(
          "history-compiled",
          `Compiled monthly stats for ${payload.month}`
        );
      });

      await step.sleep("cool-down", "10 seconds");

      await step.do("deliver-report", async () => {
        record(
          "report-delivered",
          `Sent monthly analysis to ${payload.userId}`
        );
      });
    }

    return { status: "completed", events };
  }
}
