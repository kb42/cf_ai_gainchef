// Shared domain types for GainChef agent and frontend

export type GoalType = "bulking" | "cutting" | "recomposition" | "maintaining";

export interface MacroTargets {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
}

export interface UserProfile {
  id?: string;
  name?: string;
  goalType?: GoalType;
  weight?: number;
  targetWeight?: number;
  heightInches?: number;
  age?: number;
  sex?: "male" | "female" | "non-binary";
  activityLevel?: "sedentary" | "light" | "moderate" | "intense";
  macroTargets?: MacroTargets;
  restrictions?: string[];
  preferences?: string[];
  timezone?: string;
  updatedAt?: number;
}

export interface MealLog {
  id: string;
  timestamp: number;
  food: string;
  mealType?: "breakfast" | "lunch" | "dinner" | "snack" | "post-workout";
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  notes?: string;
}

export interface DailyMacros {
  date: string; // yyyy-mm-dd
  totals: MacroTargets;
  meals: MealLog[];
}

export interface MealPlanEntry {
  mealType: NonNullable<MealLog["mealType"]>;
  name: string;
  description: string;
  macros: MacroTargets;
  ingredients: string[];
  preparationSteps: string[];
}

export interface MealPlanDay {
  date: string;
  goalSummary: string;
  meals: MealPlanEntry[];
}

export interface MealPlan {
  id: string;
  createdAt: number;
  timeframe: "daily" | "weekly";
  days: MealPlanDay[];
  shoppingListId?: string;
}

export interface ShoppingListItem {
  name: string;
  quantity: string;
  mealReferences: string[];
}

export interface ShoppingList {
  id: string;
  createdAt: number;
  timeframe: MealPlan["timeframe"];
  items: ShoppingListItem[];
}

export type WorkflowPayload =
  | {
      type: "weekly_meal_prep";
      userId: string;
      profileSnapshot: UserProfile | null;
      weekOf: string;
    }
  | {
      type: "daily_macro_check";
      userId: string;
      profileSnapshot: UserProfile | null;
      date: string;
    }
  | {
      type: "monthly_report";
      userId: string;
      profileSnapshot: UserProfile | null;
      month: string;
    };
