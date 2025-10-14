import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { getCurrentAgent } from "agents";
import type { GainChefAgent } from "./server";
import type { DailyMacros, MealPlan, ShoppingList, UserProfile } from "./types";

const macroTargetSchema = z.object({
  protein: z.number().min(0).describe("Protein grams"),
  carbs: z.number().min(0).describe("Carbohydrate grams"),
  fat: z.number().min(0).describe("Fat grams"),
  calories: z.number().min(0).describe("Total calories")
});

const mealTypeSchema = z.enum([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "post-workout"
]);

const mealLogSchema = z.object({
  food: z.string().min(2).describe("Description of the meal or food item"),
  mealType: mealTypeSchema.optional().describe("Which meal this is for"),
  protein: z.number().min(0).describe("Protein in grams"),
  carbs: z.number().min(0).describe("Carbohydrates in grams"),
  fat: z.number().min(0).describe("Fat in grams"),
  calories: z.number().min(0).describe("Total calories"),
  notes: z.string().optional().describe("Optional notes about the meal")
});

const macroTargetsSchema = macroTargetSchema
  .partial()
  .describe("Daily macro targets; provide any fields that are changing");

const profileUpdateSchema = z.object({
  name: z.string().optional(),
  goalType: z
    .enum(["bulking", "cutting", "recomposition", "maintaining"])
    .optional(),
  weight: z.number().min(0).optional(),
  targetWeight: z.number().min(0).optional(),
  heightInches: z.number().min(0).optional(),
  age: z.number().min(0).optional(),
  sex: z.enum(["male", "female", "non-binary"]).optional(),
  activityLevel: z
    .enum(["sedentary", "light", "moderate", "intense"])
    .optional(),
  macroTargets: macroTargetsSchema.optional(),
  restrictions: z.array(z.string()).optional(),
  preferences: z.array(z.string()).optional(),
  timezone: z.string().optional()
});

const mealPlanEntrySchema = z.object({
  mealType: mealTypeSchema.describe("Meal slot"),
  name: z.string().min(2).describe("Name of the meal"),
  description: z.string().describe("Short overview of the meal"),
  macros: macroTargetSchema.describe("Macro breakdown for the meal"),
  ingredients: z.array(z.string()).min(1).describe("Shopping ingredient list"),
  preparationSteps: z
    .array(z.string())
    .min(1)
    .describe("Steps to prepare the meal")
});

const mealPlanDaySchema = z.object({
  date: z.string().describe("ISO date for the meal plan day"),
  goalSummary: z.string().describe("Focus for the day (e.g., high protein)"),
  meals: z.array(mealPlanEntrySchema).min(1).describe("Meals for the day")
});

const mealPlanSchema = z.object({
  id: z.string().optional().describe("Unique identifier for the plan"),
  timeframe: z
    .enum(["daily", "weekly"])
    .default("daily")
    .describe("Plan duration"),
  days: z.array(mealPlanDaySchema).min(1).describe("Days and meals included"),
  shoppingListId: z
    .string()
    .optional()
    .describe("Associated shopping list ID if one exists")
});

const shoppingListSchema = z.object({
  id: z.string().optional().describe("Unique identifier for the shopping list"),
  planId: z.string().optional().describe("Meal plan this list supports"),
  timeframe: z
    .enum(["daily", "weekly"])
    .default("daily")
    .describe("Plan duration this list supports"),
  items: z
    .array(
      z.object({
        name: z.string().describe("Item name"),
        quantity: z.string().describe("Quantity and measurement"),
        mealReferences: z
          .array(z.string())
          .describe("Meals or recipes that use this item")
      })
    )
    .min(1)
    .describe("Shopping list entries")
});

const logMeal = tool({
  description:
    "Log a meal that was ALREADY EATEN. Use ONLY when user says past tense like 'I ate', 'I just had', 'I consumed'. NEVER use for requests like 'give me', 'suggest', 'what should I eat', 'I want' - those need text responses, not this tool.",
  inputSchema: mealLogSchema,
  execute: async (input) => {
    const { agent } = getCurrentAgent<GainChefAgent>();
    if (!agent) {
      throw new Error("GainChef agent context unavailable");
    }

    const result = await agent.logMeal({
      food: input.food,
      mealType: input.mealType,
      protein: input.protein,
      carbs: input.carbs,
      fat: input.fat,
      calories: input.calories,
      notes: input.notes,
      id: "",
      timestamp: Date.now()
    });

    const totals = result.totals;
    return `Meal logged. Today's totals: ${totals.protein}g protein / ${totals.carbs}g carbs / ${totals.fat}g fat (${totals.calories} cal).`;
  }
});

const updateProfile = tool({
  description:
    "SAVE changes to the user's fitness profile, goals, or macro targets. Permanently updates stored data. Only use when the user explicitly wants to SET or UPDATE their profile information (e.g., 'set my goals', 'update my weight', 'change my targets').",
  inputSchema: profileUpdateSchema,
  execute: async (input) => {
    const { agent } = getCurrentAgent<GainChefAgent>();
    if (!agent) {
      throw new Error("GainChef agent context unavailable");
    }

    const updated = await agent.setProfile({
      ...input,
      macroTargets: input.macroTargets
        ? {
            protein: input.macroTargets.protein ?? 0,
            carbs: input.macroTargets.carbs ?? 0,
            fat: input.macroTargets.fat ?? 0,
            calories: input.macroTargets.calories ?? 0
          }
        : undefined
    } as UserProfile);

    const summaryParts: string[] = [];
    if (input.name) summaryParts.push(`Name set to ${input.name}`);
    if (input.goalType)
      summaryParts.push(`Goal updated to ${input.goalType.toLowerCase()}`);
    if (input.weight && input.targetWeight) {
      summaryParts.push(
        `Tracking progress ${input.weight} lbs → ${input.targetWeight} lbs`
      );
    }
    if (input.macroTargets) {
      summaryParts.push(
        `Targets: ${updated.macroTargets?.protein ?? 0}p / ${
          updated.macroTargets?.carbs ?? 0
        }c / ${
          updated.macroTargets?.fat ?? 0
        }f (${updated.macroTargets?.calories ?? 0} cal)`
      );
    }

    return summaryParts.length
      ? `Profile updated. ${summaryParts.join(" | ")}`
      : "Profile updated with the provided details.";
  }
});

const getProgress = tool({
  description:
    "RETRIEVE and summarize the user's current macros and historical trend data. Read-only operation. Use when user explicitly requests progress information (e.g., 'show my progress', 'how am I doing', 'check my stats').",
  inputSchema: z.object({
    days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(3)
      .describe("How many days of history to include (default 3)")
  }),
  execute: async (input) => {
    const { agent } = getCurrentAgent<GainChefAgent>();
    if (!agent) {
      throw new Error("GainChef agent context unavailable");
    }

    const days = input.days;
    const [profile, today, history] = await Promise.all([
      agent.getProfile(),
      agent.getDailyMacros(),
      agent.getMealHistory(days)
    ]);

    return formatProgress(profile, today, history);
  }
});

const saveMealPlan = tool({
  description:
    "Save a structured multi-day meal plan. Use ONLY when user says 'create a plan', 'save a plan', 'build a plan'. NEVER use for 'give me meal ideas', 'what should I eat', 'suggest meals' - answer those with text.",
  inputSchema: mealPlanSchema,
  execute: async (input) => {
    const { agent } = getCurrentAgent<GainChefAgent>();
    if (!agent) {
      throw new Error("GainChef agent context unavailable");
    }

    const planId =
      input.id ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `plan_${Date.now()}`);

    const plan: MealPlan = {
      id: planId,
      createdAt: Date.now(),
      timeframe: input.timeframe,
      days: input.days as MealPlan["days"],
      shoppingListId: input.shoppingListId
    };

    await agent.saveMealPlan(plan);
    return `Meal plan "${planId}" saved with ${plan.days.length} day(s).`;
  }
});

const saveShoppingList = tool({
  description:
    "CREATE and STORE a shopping list based on a saved meal plan. Permanently saves the list. Only use when user explicitly wants to GENERATE or CREATE a shopping list (e.g., 'generate a shopping list', 'create my grocery list', 'make a shopping list').",
  inputSchema: shoppingListSchema,
  execute: async (input) => {
    const { agent } = getCurrentAgent<GainChefAgent>();
    if (!agent) {
      throw new Error("GainChef agent context unavailable");
    }

    const listId =
      input.id ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `shopping_${Date.now()}`);

    const list: ShoppingList = {
      id: listId,
      createdAt: Date.now(),
      timeframe: input.timeframe,
      items: input.items
    };

    await agent.saveShoppingList(list);

    if (input.planId) {
      const latestPlan = await agent.getLatestMealPlan();
      if (latestPlan && latestPlan.id === input.planId) {
        await agent.saveMealPlan({
          ...latestPlan,
          shoppingListId: listId
        });
      }
    }

    return `Shopping list "${listId}" stored with ${list.items.length} item(s).`;
  }
});

export const tools = {
  logMeal,
  updateProfile,
  getProgress,
  saveMealPlan,
  saveShoppingList
} satisfies ToolSet;

export const executions = {};

function formatProgress(
  profile: UserProfile | null,
  today: DailyMacros,
  history: DailyMacros[]
): string {
  const todayTotals = today.totals;
  const profileTarget = profile?.macroTargets;

  const baseLines = [
    `Today (${today.date}): ${todayTotals.protein}p / ${todayTotals.carbs}c / ${todayTotals.fat}f (${todayTotals.calories} cal)`,
    today.meals.length
      ? `Meals logged: ${today.meals
          .map((meal) => meal.food)
          .slice(0, 5)
          .join(", ")}`
      : "No meals logged yet today."
  ];

  if (profileTarget) {
    baseLines.push(
      `Targets: ${profileTarget.protein}p / ${profileTarget.carbs}c / ${profileTarget.fat}f (${profileTarget.calories} cal)`
    );
  }

  if (history.length > 1) {
    const otherDays = history
      .filter((day) => day.date !== today.date)
      .slice(0, 3);

    if (otherDays.length) {
      baseLines.push(
        "Recent days:",
        ...otherDays.map((day) => {
          const totals = day.totals;
          return `- ${day.date}: ${totals.protein}p / ${totals.carbs}c / ${totals.fat}f (${totals.calories} cal), ${day.meals.length} meals`;
        })
      );
    }
  }

  return baseLines.join("\n");
}
