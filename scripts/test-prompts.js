/**
 * Integration test script
 * Tests actual prompts against the running server
 * Run: node scripts/test-prompts.js (after starting npm exec wrangler -- dev --remote)
 */

const testCases = [
  {
    name: "Casual breakfast suggestion",
    prompt: "Give me a high protein breakfast",
    expected: "TEXT_ONLY"
  },
  {
    name: "Casual lunch suggestion",
    prompt: "What should I eat for lunch?",
    expected: "TEXT_ONLY"
  },
  {
    name: "Explicit meal logging (past tense)",
    prompt: "I just ate 3 eggs and toast",
    expected: "TOOL_CALL",
    expectedTool: "logMeal"
  },
  {
    name: "Progress check",
    prompt: "Show my progress",
    expected: "TOOL_CALL",
    expectedTool: "getProgress"
  }
];

async function testPrompt(testCase) {
  console.log(`\n🧪 Testing: ${testCase.name}`);
  console.log(`   Prompt: "${testCase.prompt}"`);
  console.log(`   Expected: ${testCase.expected}`);

  try {
    // Send request to local dev server
    const response = await fetch("http://localhost:8787/agents/GainChefAgent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: testCase.prompt }]
          }
        ]
      })
    });

    if (!response.ok) {
      console.log(`   ❌ HTTP Error: ${response.status}`);
      return false;
    }

    // Read streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let toolCalls = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      fullText += chunk;

      // Parse for tool invocations
      const lines = chunk.split("\n").filter((line) => line.trim());
      for (const line of lines) {
        if (line.startsWith("0:")) {
          try {
            const data = JSON.parse(line.slice(2));
            if (data.type === "tool-call") {
              toolCalls.push(data.toolName);
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }

    // Analyze result
    const hasToolCall = toolCalls.length > 0;

    if (testCase.expected === "TEXT_ONLY") {
      if (hasToolCall) {
        console.log(`   ❌ FAIL: Tool called when text was expected`);
        console.log(`      Tools invoked: ${toolCalls.join(", ")}`);
        return false;
      } else {
        console.log(`   ✅ PASS: No tool calls, text response only`);
        return true;
      }
    } else if (testCase.expected === "TOOL_CALL") {
      if (!hasToolCall) {
        console.log(`   ❌ FAIL: No tool called when tool was expected`);
        return false;
      } else if (
        testCase.expectedTool &&
        !toolCalls.includes(testCase.expectedTool)
      ) {
        console.log(`   ❌ FAIL: Wrong tool called`);
        console.log(
          `      Expected: ${testCase.expectedTool}, Got: ${toolCalls.join(", ")}`
        );
        return false;
      } else {
        console.log(`   ✅ PASS: Correct tool called`);
        return true;
      }
    }
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log("=".repeat(80));
  console.log("INTEGRATION TESTS - Testing Against Local Dev Server");
  console.log("=".repeat(80));
  console.log("\nMake sure the server is running:");
  console.log("  Terminal 1: npm run start");
  console.log("  Terminal 2: npm exec wrangler -- dev --remote");
  console.log();

  const results = [];

  for (const testCase of testCases) {
    const passed = await testPrompt(testCase);
    results.push({ name: testCase.name, passed });
    // Small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\n" + "=".repeat(80));
  console.log("TEST SUMMARY");
  console.log("=".repeat(80));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  results.forEach((r) => {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`  ${status}: ${r.name}`);
  });

  console.log();
  console.log(`Total: ${results.length} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("=".repeat(80));

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
