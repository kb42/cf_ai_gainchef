/**
 * Simple keyword analysis script
 * Analyzes tool descriptions against test prompts
 */

// Tool descriptions (manually extracted from tools.ts - UPDATED v3)
const tools = {
  logMeal: {
    description:
      "Log a meal that was ALREADY EATEN. Use ONLY when user says past tense like 'I ate', 'I just had', 'I consumed'. NEVER use for requests like 'give me', 'suggest', 'what should I eat', 'I want' - those need text responses, not this tool."
  },
  updateProfile: {
    description:
      "SAVE changes to the user's fitness profile, goals, or macro targets. Permanently updates stored data. Only use when the user explicitly wants to SET or UPDATE their profile information (e.g., 'set my goals', 'update my weight', 'change my targets')."
  },
  getProgress: {
    description:
      "RETRIEVE and summarize the user's current macros and historical trend data. Read-only operation. Use when user explicitly requests progress information (e.g., 'show my progress', 'how am I doing', 'check my stats')."
  },
  saveMealPlan: {
    description:
      "Save a structured multi-day meal plan. Use ONLY when user says 'create a plan', 'save a plan', 'build a plan'. NEVER use for 'give me meal ideas', 'what should I eat', 'suggest meals' - answer those with text."
  },
  saveShoppingList: {
    description:
      "CREATE and STORE a shopping list based on a saved meal plan. Permanently saves the list. Only use when user explicitly wants to GENERATE or CREATE a shopping list (e.g., 'generate a shopping list', 'create my grocery list', 'make a shopping list')."
  }
};

// Test prompts
const testPrompts = {
  casualQueries: [
    "Give me a high protein breakfast",
    "What should I eat for lunch?",
    "Suggest some meal ideas",
    "What's a good post-workout snack?"
  ],
  explicitLogging: [
    "I just ate 3 eggs and toast",
    "Log my breakfast: oatmeal",
    "I had chicken for lunch"
  ],
  mealPlanning: ["Create a 3-day meal plan", "Build me a weekly plan"],
  progressChecks: ["Show my progress", "How am I doing?"]
};

function extractKeywords(text) {
  return (
    text
      .toLowerCase()
      .match(/\b\w{3,}\b/g)
      ?.filter(
        (word) =>
          ![
            "only",
            "when",
            "user",
            "that",
            "this",
            "with",
            "the",
            "for",
            "and",
            "use",
            "not",
            "are"
          ].includes(word)
      ) || []
  );
}

function analyzeMatch(prompt, tool) {
  const promptKW = extractKeywords(prompt);
  const toolKW = extractKeywords(tool.description);
  const matched = promptKW.filter((kw) => toolKW.includes(kw));
  return {
    score: matched.length,
    matched
  };
}

console.log("=".repeat(80));
console.log("TOOL KEYWORD ANALYSIS");
console.log("=".repeat(80));
console.log();

// Show tool keywords
console.log("📋 TOOL DESCRIPTIONS & KEYWORDS:\n");
Object.entries(tools).forEach(([name, tool]) => {
  console.log(`  ${name}:`);
  console.log(`    Desc: ${tool.description.substring(0, 80)}...`);
  console.log(
    `    Keywords: ${extractKeywords(tool.description).slice(0, 15).join(", ")}`
  );
  console.log();
});

console.log("=".repeat(80));
console.log();

// Analyze each category
Object.entries(testPrompts).forEach(([category, prompts]) => {
  console.log(`\n🔍 ${category.toUpperCase()}`);
  console.log("-".repeat(80));

  prompts.forEach((prompt) => {
    console.log(`\n  Query: "${prompt}"`);
    const expected =
      category === "casualQueries" ? "TEXT ONLY (no tools)" : "TOOL INVOCATION";
    console.log(`  Expected: ${expected}`);

    const matches = Object.entries(tools)
      .map(([name, tool]) => ({
        tool: name,
        ...analyzeMatch(prompt, tool)
      }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score);

    if (matches.length === 0) {
      console.log(`  ✅ No keyword overlap → Should respond with text`);
    } else {
      console.log(`  Keyword matches found:`);
      matches.forEach((m) => {
        console.log(
          `     ${m.tool}: ${m.score} match(es) [${m.matched.join(", ")}]`
        );
      });

      if (category === "casualQueries") {
        console.log(`  ❌ PROBLEM: Casual query matches tool keywords!`);
      }
    }
  });
  console.log();
});

console.log("=".repeat(80));
console.log("DONE");
console.log("=".repeat(80));
