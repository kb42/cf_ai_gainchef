import { routeAgentRequest, type Schedule } from "agents";
import { AIChatAgent } from "agents/ai-chat-agent";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet,
  type UIMessage,
  type UIMessageStreamWriter
} from "ai";
import type { createWorkersAI } from "workers-ai-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { cleanupMessages } from "./utils";
import { tools } from "./tools";
import type { DurableObjectStorage } from "@cloudflare/workers-types";
import type {
  DailyMacros,
  MacroTargets,
  MealLog,
  MealPlan,
  ShoppingList,
  UserProfile,
  WorkflowPayload
} from "./types";
export { MealPrepWorkflow } from "./workflow";

const MODEL_ID = "gpt-4o-mini";

interface ResolvedModel {
  provider: string;
  model:
    | ReturnType<ReturnType<typeof createWorkersAI>>
    | ReturnType<ReturnType<typeof createOpenAI>>;
  supportsTools: boolean;
  fallback?: () => ResolvedModel;
}

const STORAGE_KEYS = {
  PROFILE: "profile",
  MEAL_DAILY_PREFIX: "daily-macros:",
  MEAL_DATES: "daily-macros:dates",
  MEAL_PLAN_ACTIVE: "meal-plan:active",
  MEAL_PLAN_HISTORY: "meal-plan:history",
  SHOPPING_LISTS: "shopping-lists"
} as const;

const EMPTY_TOTALS: MacroTargets = {
  protein: 0,
  carbs: 0,
  fat: 0,
  calories: 0
};

const MAX_STORED_MEAL_HISTORY = 30;
const MAX_MEAL_PLAN_HISTORY = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
} as const;

function toJsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers
  });
}

interface SystemPromptContext {
  profile: UserProfile | null;
  today: DailyMacros;
  history: DailyMacros[];
  activePlan: MealPlan | null;
  shoppingList: ShoppingList | null;
}

function formatProfile(profile: UserProfile | null): string {
  if (!profile) {
    return "No profile captured yet.";
  }

  const lines: string[] = [];
  if (profile.name) lines.push(`- Name: ${profile.name}`);
  if (profile.goalType) lines.push(`- Goal: ${profile.goalType}`);
  if (profile.weight) lines.push(`- Weight: ${profile.weight} lbs`);
  if (profile.targetWeight) {
    lines.push(`- Target weight: ${profile.targetWeight} lbs`);
  }
  if (profile.heightInches) {
    const feet = Math.floor(profile.heightInches / 12);
    const inches = profile.heightInches % 12;
    lines.push(`- Height: ${feet}'${inches}"`);
  }
  if (profile.activityLevel) {
    lines.push(`- Activity: ${profile.activityLevel}`);
  }
  if (profile.macroTargets) {
    const targets = profile.macroTargets;
    lines.push(
      `- Daily targets: ${targets.protein}g protein / ${targets.carbs}g carbs / ${targets.fat}g fat (${targets.calories} cal)`
    );
  }
  if (profile.preferences?.length) {
    lines.push(`- Food preferences: ${profile.preferences.join(", ")}`);
  }
  if (profile.restrictions?.length) {
    lines.push(`- Dietary restrictions: ${profile.restrictions.join(", ")}`);
  }
  if (profile.timezone) {
    lines.push(`- Timezone: ${profile.timezone}`);
  }

  return lines.length ? lines.join("\n") : "Profile exists but is empty.";
}

function formatDailyMacros(daily: DailyMacros): string {
  if (!daily.meals.length) {
    return "No meals logged.";
  }

  const mealLines = daily.meals
    .map((meal) => {
      const typeLabel = meal.mealType ? `${meal.mealType} – ` : "";
      return `${typeLabel}${meal.food}: ${meal.protein}p / ${meal.carbs}c / ${meal.fat}f (${meal.calories} cal)`;
    })
    .join("\n");

  const totals = daily.totals;
  const totalsLine = `Totals: ${totals.protein}p / ${totals.carbs}c / ${totals.fat}f (${totals.calories} cal)`;

  return `${mealLines}\n${totalsLine}`;
}

function formatRecentHistory(history: DailyMacros[]): string {
  if (!history.length) {
    return "No prior days logged yet.";
  }

  return history
    .map((day) => {
      const totals = day.totals;
      return `${day.date}: ${totals.protein}p / ${totals.carbs}c / ${totals.fat}f (${totals.calories} cal) across ${day.meals.length} meal(s)`;
    })
    .join("\n");
}

function formatMealPlan(plan: MealPlan | null): string {
  if (!plan) {
    return "No active meal plan.";
  }

  const headline = `Plan timeframe: ${plan.timeframe}, created ${new Date(
    plan.createdAt
  ).toLocaleDateString()}`;
  const dayPreview = plan.days
    .slice(0, 2)
    .map((day) => {
      const meals = day.meals
        .map(
          (meal) =>
            `  - ${meal.mealType}: ${meal.name} (${meal.macros.protein}p/${meal.macros.carbs}c/${meal.macros.fat}f)`
        )
        .join("\n");
      return `${day.date}: ${day.goalSummary}\n${meals}`;
    })
    .join("\n");

  return `${headline}\n${dayPreview || "No meals listed yet."}`;
}

function formatShoppingList(list: ShoppingList | null): string {
  if (!list) {
    return "No shopping list generated.";
  }

  const lines: string[] = [
    `List timeframe: ${list.timeframe}, items: ${list.items.length}`
  ];

  const topItems = list.items.slice(0, 5).map((item) => {
    return `  - ${item.name}: ${item.quantity}`;
  });

  lines.push(...topItems);
  if (list.items.length > 5) {
    lines.push(`  ...and ${list.items.length - 5} more item(s).`);
  }

  return lines.join("\n");
}

function computeTotals(meals: MealLog[]): MacroTargets {
  return meals.reduce(
    (totals, meal) => ({
      protein: totals.protein + meal.protein,
      carbs: totals.carbs + meal.carbs,
      fat: totals.fat + meal.fat,
      calories: totals.calories + meal.calories
    }),
    { ...EMPTY_TOTALS }
  );
}

export class GainChefAgent extends AIChatAgent<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // quick reset hook
    if (url.pathname === "/api/agent/reset" && request.method === "POST") {
      try {
        await this.clearAllData();
        return toJsonResponse({ success: true, message: "All data cleared" });
      } catch (error) {
        console.error("Failed to clear all data", error);
        return toJsonResponse(
          { error: "Failed to clear all data" },
          { status: 500 }
        );
      }
    }

    return super.fetch(request);
  }

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    const modelInfo = this.resolveModel();

    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        if (!(await this.bumpRateLimit())) {
          this.streamPlainText(
            writer,
            "i need a breather—too many requests right now. try again in a few minutes."
          );
          return;
        }

        if (!modelInfo) {
          console.error(
            "[GainChef] No model could be resolved. Check AI bindings or secrets."
          );
          this.streamPlainText(
            writer,
            "i can't reach an ai model right now. make sure an openai key is configured."
          );
          return;
        }

        console.info("[GainChef] Using model", {
          provider: modelInfo.provider
        });

        const cleanedMessages = cleanupMessages(this.messages);
        if (!this.isFoodOrFitnessPrompt(cleanedMessages)) {
          this.streamPlainText(
            writer,
            "let's keep it about food, nutrition, or workouts. happy to chat when you're ready."
          );
          return;
        }

        const [profile, today, history, activePlan] = await Promise.all([
          this.getProfile(),
          this.getDailyMacros(),
          this.getMealHistory(3),
          this.getLatestMealPlan()
        ]);
        const shoppingList = activePlan?.shoppingListId
          ? await this.getShoppingList(activePlan.shoppingListId)
          : await this.getShoppingList();

        const systemPrompt = this.buildSystemPrompt({
          profile,
          today,
          history,
          activePlan,
          shoppingList
        });

        const runModel = (info: ResolvedModel) => {
          const prompt = info.supportsTools
            ? systemPrompt
            : `${systemPrompt}\n\nNote: I'm operating without automated logging right now, so I'll give you recommendations directly—log meals or update your profile manually.`;

          const options: Record<string, unknown> = {
            system: prompt,
            messages: convertToModelMessages(cleanedMessages),
            model: info.model,
            onFinish: onFinish as unknown as StreamTextOnFinishCallback<
              typeof allTools
            >,
            maxSteps: 3, // let the model finish tool loop
            onStepFinish: async (rawEvent: unknown) => {
              const event = rawEvent as {
                toolCalls?: unknown[];
                toolResults?: Array<{
                  toolName: string;
                  input?: unknown;
                  output?: string;
                }>;
              };

              if (
                event.toolCalls &&
                event.toolCalls.length > 0 &&
                event.toolResults &&
                event.toolResults.length > 0
              ) {
                const toolResult = event.toolResults[0];
                const toolName = toolResult.toolName;
                const toolInput =
                  (toolResult.input as Record<string, unknown> | undefined) ||
                  {};

                if (
                  Object.keys(toolInput).length === 0 &&
                  toolName !== "getProgress"
                ) {
                  return; // quick guard, nothing to do
                }

                if (toolName === "logMeal") {
                  const food = (toolInput.food as string) || "meal";
                  const protein = Number(toolInput.protein ?? 0);
                  const carbs = Number(toolInput.carbs ?? 0);
                  const fat = Number(toolInput.fat ?? 0);
                  const calories = Number(toolInput.calories ?? 0);

                  this.streamPlainText(
                    writer,
                    `\n\nDone! Your ${food} has been logged. Here are the macros: ${protein}g protein, ${carbs}g carbs, ${fat}g fat, ${calories} calories.`
                  );
                } else if (toolName === "saveMealPlan") {
                  const planDays =
                    toolInput &&
                    typeof toolInput === "object" &&
                    "days" in toolInput &&
                    Array.isArray((toolInput as { days?: unknown }).days)
                      ? ((toolInput as { days?: unknown }).days as Array<
                          Record<string, unknown>
                        >)
                      : [];

                  if (planDays.length === 0) {
                    this.streamPlainText(writer, "\n\nNo meals in the plan!");
                  } else {
                    let output = "\n\n**Your meal plan is ready!**\n\n";
                    planDays.forEach((day, idx) => {
                      const dateValue = day.date as string | undefined;
                      const date = dateValue
                        ? new Date(dateValue).toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "short",
                            day: "numeric"
                          })
                        : `Day ${idx + 1}`;
                      const goalSummary =
                        (day.goalSummary as string) || "No goal set";
                      output += `**${date}** - ${goalSummary}\n`;
                      const meals = Array.isArray(day.meals)
                        ? (day.meals as Array<Record<string, unknown>>)
                        : [];
                      if (meals.length > 0) {
                        meals.forEach((meal) => {
                          const macros =
                            (meal.macros as Record<string, number>) || {};
                          const calories = macros.calories ?? 0;
                          const protein = macros.protein ?? 0;
                          const carbs = macros.carbs ?? 0;
                          const fat = macros.fat ?? 0;
                          const mealName = (meal.name as string) || "meal";
                          const mealType = (meal.mealType as string) || "meal";
                          output += `  • **${mealName}** (${mealType})\n`;
                          output += `    ${calories} cal - ${protein}p / ${carbs}c / ${fat}f\n`;
                          if (meal.description) {
                            output += `    _${meal.description}_\n`;
                          }
                        });
                      } else {
                        output += `  • No meals planned\n`;
                      }
                      output += `\n`;
                    });
                    this.streamPlainText(writer, output);
                  }
                } else if (toolName === "saveShoppingList") {
                  const items =
                    toolInput &&
                    typeof toolInput === "object" &&
                    "items" in toolInput &&
                    Array.isArray((toolInput as { items?: unknown }).items)
                      ? ((toolInput as { items?: unknown }).items as Array<
                          Record<string, unknown>
                        >)
                      : [];

                  if (items.length === 0) {
                    this.streamPlainText(
                      writer,
                      "\n\nNo items in the shopping list!"
                    );
                  } else {
                    const itemsByMeal = new Map<
                      string,
                      Array<{ name: string; quantity: string }>
                    >();

                    items.forEach((item) => {
                      const mealRefs = Array.isArray(item.mealReferences)
                        ? (item.mealReferences as string[])
                        : [];
                      const itemName = (item.name as string) || "item";
                      const quantity = (item.quantity as string) || "1";

                      if (mealRefs.length > 0) {
                        mealRefs.forEach((mealRef) => {
                          if (!itemsByMeal.has(mealRef)) {
                            itemsByMeal.set(mealRef, []);
                          }
                          itemsByMeal.get(mealRef)!.push({
                            name: itemName,
                            quantity
                          });
                        });
                      } else {
                        if (!itemsByMeal.has("Other")) {
                          itemsByMeal.set("Other", []);
                        }
                        itemsByMeal.get("Other")!.push({
                          name: itemName,
                          quantity
                        });
                      }
                    });

                    let output = "\n\n**Your shopping list is ready!**\n\n";
                    itemsByMeal.forEach((mealItems, mealName) => {
                      output += `**${mealName}:**\n`;
                      mealItems.forEach((item) => {
                        output += `  • ${item.name} - ${item.quantity}\n`;
                      });
                      output += `\n`;
                    });
                    this.streamPlainText(writer, output);
                  }
                } else if (toolName === "getProgress") {
                  const output = toolResult.output || "";
                  this.streamPlainText(
                    writer,
                    `\n\n**Here's your progress:**\n\n${output}`
                  );
                } else if (toolName === "updateProfile") {
                  this.streamPlainText(writer, "\n\n**Profile updated!**");
                } else {
                  this.streamPlainText(
                    writer,
                    `\n\nDone! The ${toolName} task has been completed.`
                  );
                }
              }
            }
          };

          if (info.supportsTools) {
            options.tools = allTools;
          }

          const result = streamText(
            options as Parameters<typeof streamText>[0]
          );
          writer.merge(result.toUIMessageStream());
        };

        try {
          runModel(modelInfo);
        } catch (error) {
          if (modelInfo.fallback && this.isRecoverableModelError(error)) {
            const fallbackInfo = modelInfo.fallback();
            console.warn("[GainChef] Retrying with fallback model", {
              originalProvider: modelInfo.provider,
              fallbackProvider: fallbackInfo.provider,
              error: this.serializeError(error)
            });
            runModel(fallbackInfo);
          } else {
            console.error(
              "[GainChef] Generation failed",
              this.serializeError(error)
            );
            this.streamPlainText(
              writer,
              "I hit a snag generating that answer. Please try again in a moment."
            );
          }
        }
      },
      onError: (error) => {
        console.error("[GainChef] Streaming error", error);
        return "I ran into an issue generating that response. Please try again in a moment.";
      }
    });

    return createUIMessageStreamResponse({ stream });
  }

  private resolveModel(): ResolvedModel | null {
    try {
      const openaiKey =
        (this.env as { OPENAI_API_KEY?: string }).OPENAI_API_KEY ||
        process.env.OPENAI_API_KEY;

      if (!openaiKey) {
        return null;
      }

      const openai = createOpenAI({ apiKey: openaiKey });

      return {
        provider: "openai:gpt-4o-mini",
        model: openai("gpt-4o-mini"),
        supportsTools: true
      };
    } catch (error) {
      console.error("[GainChef] Failed to initialize language model", error);
      return null;
    }
  }

  private streamPlainText(writer: UIMessageStreamWriter, text: string) {
    const id = generateId();
    writer.write({ type: "text-start", id });
    writer.write({ type: "text-delta", id, delta: text });
    writer.write({ type: "text-end", id });
  }

  private isRecoverableModelError(error: unknown): boolean {
    const asError = error instanceof Error ? error : null;
    const message = asError?.message ?? "";
    const name = asError?.name ?? "";
    return (
      message.includes("No such model") ||
      message.includes("5007") ||
      name === "InferenceUpstreamError"
    );
  }

  private serializeError(error: unknown) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  private buildSystemPrompt(context: SystemPromptContext): string {
    const { profile, today, history, activePlan, shoppingList } = context;

    const profileSection = formatProfile(profile);
    const todaySection = formatDailyMacros(today);
    const historySection = formatRecentHistory(history);
    const mealPlanSection = formatMealPlan(activePlan);
    const shoppingSection = formatShoppingList(shoppingList);

    return `You are GainChef, a friendly nutrition coach.

CRITICAL: Always include a short text message before AND after using tools. Examples:
- Before logMeal: "Got it! Logging that now..."
- After logMeal: "Logged! Your totals are updated."
- Before saveMealPlan: "Creating your meal plan..."
- After saveMealPlan: "Done! Your plan is ready."
- Before getProgress: "Let me check your stats..."

When users ask "what should I eat" or "give me ideas" - provide meal suggestions in text. Don't use tools.
When users say "I ate X" - write a brief message, call logMeal, then confirm completion.

Profile:
${profileSection}

Today (${today.date}):
${todaySection}

Recent history:
${historySection}

Active plan:
${mealPlanSection}

Shopping list:
${shoppingSection}`.trim();
  }

  async setProfile(profile: UserProfile): Promise<UserProfile> {
    const existing = (await this.getProfile()) ?? {};
    const merged: UserProfile = {
      ...existing,
      ...profile,
      updatedAt: Date.now()
    };
    await this.storagePut(STORAGE_KEYS.PROFILE, merged);
    return merged;
  }

  async getProfile(): Promise<UserProfile | null> {
    return await this.storageGet<UserProfile>(STORAGE_KEYS.PROFILE);
  }

  async logMeal(meal: MealLog): Promise<DailyMacros> {
    const timestamp = meal.timestamp ?? Date.now();
    const date = this.toDateString(new Date(timestamp));
    const normalizedMeal: MealLog = {
      ...meal,
      id:
        meal.id ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `meal_${timestamp}`),
      timestamp
    };

    const existing = await this.readDaily(date);
    const meals = existing ? [...existing.meals] : [];
    meals.push(normalizedMeal);
    meals.sort((a, b) => a.timestamp - b.timestamp);

    const totals = computeTotals(meals);
    const updated: DailyMacros = {
      date,
      meals,
      totals
    };

    await this.writeDaily(updated);
    await this.updateMealDates(date);

    return updated;
  }

  async getDailyMacros(
    date: string = this.toDateString()
  ): Promise<DailyMacros> {
    const existing = await this.readDaily(date);
    if (existing) {
      return existing;
    }

    return {
      date,
      meals: [],
      totals: { ...EMPTY_TOTALS }
    };
  }

  async getMealHistory(limit = 7): Promise<DailyMacros[]> {
    const storedDates =
      (await this.storageGet<string[]>(STORAGE_KEYS.MEAL_DATES)) ?? [];
    if (!storedDates.length) {
      return [];
    }

    const ordered = storedDates
      .sort((a, b) => b.localeCompare(a))
      .slice(0, limit);
    const results = await Promise.all(
      ordered.map(async (date: string) => this.readDaily(date))
    );

    return results.filter((day): day is DailyMacros => Boolean(day));
  }

  async getLatestMealPlan(): Promise<MealPlan | null> {
    return await this.storageGet<MealPlan>(STORAGE_KEYS.MEAL_PLAN_ACTIVE);
  }

  async saveMealPlan(plan: MealPlan): Promise<void> {
    await this.storagePut(STORAGE_KEYS.MEAL_PLAN_ACTIVE, plan);

    const history =
      (await this.storageGet<MealPlan[]>(STORAGE_KEYS.MEAL_PLAN_HISTORY)) ?? [];

    const deduped = [
      plan,
      ...history.filter((item: MealPlan) => item.id !== plan.id)
    ].slice(0, MAX_MEAL_PLAN_HISTORY);

    await this.storagePut(STORAGE_KEYS.MEAL_PLAN_HISTORY, deduped);
  }

  async getMealPlanHistory(limit = MAX_MEAL_PLAN_HISTORY): Promise<MealPlan[]> {
    const history =
      (await this.storageGet<MealPlan[]>(STORAGE_KEYS.MEAL_PLAN_HISTORY)) ?? [];
    return history.slice(0, limit);
  }

  async saveShoppingList(list: ShoppingList): Promise<void> {
    const existing =
      (await this.storageGet<Record<string, ShoppingList>>(
        STORAGE_KEYS.SHOPPING_LISTS
      )) ?? {};

    const updated: Record<string, ShoppingList> = {
      ...existing,
      [list.id]: list
    };

    await this.storagePut(STORAGE_KEYS.SHOPPING_LISTS, updated);
  }

  async getShoppingList(id?: string): Promise<ShoppingList | null> {
    const existing =
      (await this.storageGet<Record<string, ShoppingList>>(
        STORAGE_KEYS.SHOPPING_LISTS
      )) ?? {};

    if (id) {
      return existing[id] ?? null;
    }

    const lists = Object.values(existing) as ShoppingList[];
    if (!lists.length) {
      return null;
    }

    return (
      lists.sort(
        (a: ShoppingList, b: ShoppingList) => b.createdAt - a.createdAt
      )[0] ?? null
    );
  }

  async clearAllData(): Promise<void> {
    await this.storage.deleteAll();
    this.messages = [];
    await this.saveMessages([]);
  }

  private async bumpRateLimit(): Promise<boolean> {
    const key = "rate-limit";
    const now = Date.now();
    const record = (await this.storageGet<{ count: number; reset: number }>(
      key
    )) ?? {
      count: 0,
      reset: now + RATE_LIMIT_WINDOW_MS
    };

    if (now > record.reset) {
      record.count = 0;
      record.reset = now + RATE_LIMIT_WINDOW_MS;
    }

    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
      await this.storagePut(key, record);
      return false;
    }

    record.count += 1;
    await this.storagePut(key, record);
    return true;
  }

  private isFoodOrFitnessPrompt(_messages: UIMessage[]): boolean {
    return true;
  }

  private get storage(): DurableObjectStorage {
    return this.ctx.storage as unknown as DurableObjectStorage;
  }

  private async storageGet<T>(key: string): Promise<T | null> {
    const stored = await this.storage.get<T>(key);
    return stored ?? null;
  }

  private async storagePut<T>(key: string, value: T): Promise<void> {
    await this.storage.put<T>(key, value);
  }

  private getDailyKey(date: string): string {
    return `${STORAGE_KEYS.MEAL_DAILY_PREFIX}${date}`;
  }

  private toDateString(date: Date = new Date()): string {
    return date.toISOString().slice(0, 10);
  }

  private async readDaily(date: string): Promise<DailyMacros | null> {
    return await this.storageGet<DailyMacros>(this.getDailyKey(date));
  }

  private async writeDaily(day: DailyMacros): Promise<void> {
    await this.storagePut(this.getDailyKey(day.date), day);
  }

  private async updateMealDates(date: string): Promise<void> {
    const dates =
      (await this.storageGet<string[]>(STORAGE_KEYS.MEAL_DATES)) ?? [];
    if (!dates.includes(date)) {
      dates.push(date);
    }
    const ordered = dates
      .sort((a: string, b: string) => b.localeCompare(a))
      .slice(0, MAX_STORED_MEAL_HISTORY);
    await this.storagePut(STORAGE_KEYS.MEAL_DATES, ordered);
  }

  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/health") {
      return toJsonResponse({
        status: "ok",
        model: MODEL_ID,
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/transcribe" && request.method === "POST") {
      try {
        const formData = await request.formData();
        const audioFile = formData.get("audio");

        if (!audioFile || !(audioFile instanceof Blob)) {
          return toJsonResponse(
            { error: "No audio file provided" },
            { status: 400 }
          );
        }

        // Convert audio blob to array buffer
        const audioBuffer = await audioFile.arrayBuffer();
        const audioArray = new Uint8Array(audioBuffer);

        // Use Cloudflare AI Whisper model for transcription
        const response = await env.AI.run("@cf/openai/whisper", {
          audio: Array.from(audioArray)
        });

        const result = response as { text?: string };

        return toJsonResponse({
          text: result.text || "",
          success: true
        });
      } catch (error) {
        console.error("Transcription error:", error);
        return toJsonResponse(
          { error: "Failed to transcribe audio" },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/trigger-workflow" && request.method === "POST") {
      try {
        const body = (await request.json()) as WorkflowPayload | undefined;
        if (!body || typeof body !== "object" || !("type" in body)) {
          return toJsonResponse(
            { error: "Invalid workflow payload" },
            { status: 400 }
          );
        }

        const instance = await env.MEAL_PREP.create({ params: body });
        return toJsonResponse(
          {
            workflowId: instance.id,
            status: "queued"
          },
          { status: 202 }
        );
      } catch (error) {
        console.error("Failed to trigger workflow", error);
        return toJsonResponse(
          { error: "Failed to trigger workflow" },
          { status: 400 }
        );
      }
    }

    const routed = await routeAgentRequest(request, env);
    if (routed) {
      return routed;
    }

    return new Response("Not found", {
      status: 404,
      headers: CORS_HEADERS
    });
  }
} satisfies ExportedHandler<Env>;
