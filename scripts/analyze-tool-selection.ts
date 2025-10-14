/**
 * Debug script to analyze tool selection logic
 * Shows what the LLM "sees" when deciding which tool to call
 */

import { tools } from "../src/tools";

// Test prompts categorized by expected behavior
const testPrompts = {
  casualQueries: [
    "Give me a high protein breakfast",
    "What should I eat for lunch?",
    "Suggest some meal ideas",
    "What's a good post-workout snack?",
    "I need breakfast ideas"
  ],
  explicitLogging: [
    "I just ate 3 eggs and toast",
    "Log my breakfast: oatmeal with protein powder",
    "I had chicken and rice for lunch",
    "I ate a protein shake"
  ],
  mealPlanning: [
    "Create a 3-day meal plan",
    "Build me a weekly plan",
    "Save a meal plan for this week"
  ],
  progressChecks: [
    "Show my progress",
    "How am I doing today?",
    "Check my totals"
  ]
};

// Extract tool information
interface ToolInfo {
  name: string;
  description: string;
  keywords: string[];
}

function extractKeywords(text: string): string[] {
  return (
    text
      .toLowerCase()
      .match(/\b\w{4,}\b/g) // Words with 4+ chars
      ?.filter(
        (word) =>
          !["only", "when", "user", "that", "this", "with"].includes(word)
      ) || []
  );
}

function analyzeToolMatch(
  prompt: string,
  tool: ToolInfo
): {
  matchScore: number;
  matchedKeywords: string[];
} {
  const promptKeywords = extractKeywords(prompt);
  const matchedKeywords = promptKeywords.filter((kw) =>
    tool.keywords.includes(kw)
  );

  return {
    matchScore: matchedKeywords.length,
    matchedKeywords
  };
}

console.log("=".repeat(80));
console.log("TOOL SELECTION ANALYSIS");
console.log("=".repeat(80));
console.log();

// Analyze each tool
const toolInfos: ToolInfo[] = Object.entries(tools).map(([name, tool]) => {
  const desc = (tool as any).description || "";
  return {
    name,
    description: desc,
    keywords: extractKeywords(desc)
  };
});

console.log("📋 AVAILABLE TOOLS:\n");
toolInfos.forEach((tool) => {
  console.log(`  ${tool.name}:`);
  console.log(`    Description: ${tool.description.substring(0, 100)}...`);
  console.log(`    Keywords: ${tool.keywords.join(", ")}`);
  console.log();
});

console.log("=".repeat(80));
console.log();

// Analyze each test category
Object.entries(testPrompts).forEach(([category, prompts]) => {
  console.log(`\n🔍 CATEGORY: ${category.toUpperCase()}`);
  console.log("-".repeat(80));

  prompts.forEach((prompt) => {
    console.log(`\n  Query: "${prompt}"`);
    console.log(
      `  Expected: ${category === "casualQueries" ? "TEXT RESPONSE (no tools)" : "TOOL INVOCATION"}`
    );
    console.log(`  Prompt keywords: ${extractKeywords(prompt).join(", ")}`);

    const matches = toolInfos
      .map((tool) => ({
        tool: tool.name,
        ...analyzeToolMatch(prompt, tool)
      }))
      .filter((m) => m.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore);

    if (matches.length === 0) {
      console.log(
        `  ✅ Result: No keyword matches → LLM should respond with text`
      );
    } else {
      console.log(`  ⚠️  Potential tool matches:`);
      matches.forEach((match) => {
        console.log(
          `     - ${match.tool} (score: ${match.matchScore}, matched: ${match.matchedKeywords.join(", ")})`
        );
      });

      if (category === "casualQueries") {
        console.log(`  ❌ PROBLEM: Casual query has tool keyword overlap!`);
      } else {
        console.log(`  ✅ Expected: Tool should be called`);
      }
    }
  });

  console.log();
});

console.log("=".repeat(80));
console.log("ANALYSIS COMPLETE");
console.log("=".repeat(80));
console.log();
console.log("📊 SUMMARY:");
console.log(
  "  - Casual queries should have minimal keyword overlap with tool descriptions"
);
console.log("  - Explicit action queries should match tool keywords");
console.log(
  "  - If casual queries match tool keywords, the system prompt must be VERY strong"
);
console.log();
