/** biome-ignore-all lint/correctness/useUniqueElementIds: it's alright */
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useAgent } from "agents/react";
import { isToolUIPart } from "ai";
import { useAgentChat } from "agents/ai-react";
import type { UIMessage } from "@ai-sdk/react";
import type { tools } from "./tools";
import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { Textarea } from "@/components/textarea/Textarea";
import { MemoizedMarkdown } from "@/components/memoized-markdown";
import { ToolInvocationCard } from "@/components/tool-invocation-card/ToolInvocationCard";
import { ThinkingAnimation } from "@/components/thinking-animation/ThinkingAnimation";
import {
  Moon,
  Sun,
  Trash,
  PaperPlaneRight,
  StopCircle,
  ChefHat
} from "@phosphor-icons/react";

// tools that should double-check with user
const toolsRequiringConfirmation: (keyof typeof tools)[] = [
  "logMeal",
  "updateProfile",
  "saveMealPlan",
  "saveShoppingList"
];

const DEFAULT_TOTALS = {
  protein: 0,
  carbs: 0,
  fat: 0,
  calories: 0
};

const TOTALS_REGEX =
  /([0-9]+)\s*g protein[^0-9]*([0-9]+)\s*g carbs[^0-9]*([0-9]+)\s*g fat[^0-9]*\(([0-9]+)\s*cal\)/i;

function extractTotalsFromString(
  text: string | null
): typeof DEFAULT_TOTALS | null {
  if (!text) return null;
  const match = text.match(TOTALS_REGEX);
  if (!match) return null;
  const [, protein, carbs, fat, calories] = match;
  return {
    protein: Number(protein),
    carbs: Number(carbs),
    fat: Number(fat),
    calories: Number(calories)
  };
}

function outputToText(output: unknown): string | null {
  if (typeof output === "string") {
    return output;
  }
  if (
    output &&
    typeof output === "object" &&
    "content" in output &&
    Array.isArray(
      (output as { content: Array<{ type: string; text: string }> }).content
    )
  ) {
    const items = (
      output as { content: Array<{ type: string; text: string }> }
    ).content
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n");
    return items || null;
  }
  return null;
}
export default function Chat() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    // Check localStorage first, default to dark if not found
    const savedTheme = localStorage.getItem("theme");
    return (savedTheme as "dark" | "light") || "dark";
  });
  const [textareaHeight, setTextareaHeight] = useState("auto");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    // keep theme vibe in sync
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }

    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
  };

  // generate unique session ID for user isolation
  const sessionId = useMemo(() => {
    const storageKey = 'gainchef-session-id';
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;

    const newId = crypto.randomUUID();
    localStorage.setItem(storageKey, newId);
    return newId;
  }, []);

  const agent = useAgent({
    agent: "GainChefAgent",  // agent class name
    name: sessionId          // unique instance per session
  });

  const [agentInput, setAgentInput] = useState("");
  const handleAgentInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setAgentInput(e.target.value);
  };

  const handleAgentSubmit = async (
    e: React.FormEvent,
    extraData: Record<string, unknown> = {}
  ) => {
    e.preventDefault();
    if (!agentInput.trim()) return;

    const message = agentInput;
    setAgentInput("");

    await sendMessage(
      {
        role: "user",
        parts: [{ type: "text", text: message }]
      },
      {
        body: extraData
      }
    );
  };

  const {
    messages: agentMessages,
    addToolResult,
    clearHistory,
    status,
    sendMessage,
    stop
  } = useAgentChat<unknown, UIMessage<{ createdAt: string }>>({
    agent
  });

  const clearAllData = async () => {
    // nuke chat and macros
    clearHistory();

    try {
      await fetch("/api/agent/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });
    } catch (error) {
      console.error("Failed to reset agent data:", error);
    }
  };

  useEffect(() => {
    agentMessages.length > 0 && scrollToBottom();
  }, [agentMessages, scrollToBottom]);

  const pendingToolCallConfirmation = agentMessages.some((m: UIMessage) =>
    m.parts?.some(
      (part) =>
        isToolUIPart(part) &&
        part.state === "input-available" &&
        // quick local check
        toolsRequiringConfirmation.includes(
          part.type.replace("tool-", "") as keyof typeof tools
        )
    )
  );

  const macrosTotals = useMemo(() => {
    for (let i = agentMessages.length - 1; i >= 0; i--) {
      const message = agentMessages[i];
      if (!message.parts) continue;
      for (const part of message.parts) {
        if (isToolUIPart(part) && part.state === "output-available") {
          const totals = extractTotalsFromString(outputToText(part.output));
          if (totals) {
            return totals;
          }
        }
        if (part.type === "text" && "text" in part) {
          const totals = extractTotalsFromString(
            (part as { text?: string }).text ?? null
          );
          if (totals) {
            return totals;
          }
        }
      }
    }
    return DEFAULT_TOTALS;
  }, [agentMessages]);

  const macroCards = useMemo(
    () => [
      { label: "Protein", value: `${macrosTotals.protein}g` },
      { label: "Carbs", value: `${macrosTotals.carbs}g` },
      { label: "Fat", value: `${macrosTotals.fat}g` },
      { label: "Calories", value: `${macrosTotals.calories}` }
    ],
    [macrosTotals]
  );

  const connectionStatus = useMemo(() => {
    const statusString = String(status);
    if (statusString.includes("connect")) return "Connecting";
    if (statusString === "ready" || statusString === "streaming") {
      return "Connected";
    }
    if (statusString.includes("error")) return "Error";
    if (statusString === "idle" || statusString === "unknown") {
      return "Idle";
    }
    return statusString.charAt(0).toUpperCase() + statusString.slice(1);
  }, [status]);

  const handleQuickPrompt = (prompt: string) => {
    void sendMessage({
      role: "user",
      parts: [{ type: "text", text: prompt }]
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="h-[100dvh] w-full md:p-4 flex justify-center items-center bg-gradient-to-br from-slate-50 to-emerald-50 dark:from-zinc-900 dark:to-gray-900 overflow-hidden">
      <div className="h-full md:h-[calc(100vh-2rem)] w-full mx-auto max-w-lg md:max-w-2xl lg:max-w-4xl flex flex-col md:shadow-2xl md:rounded-xl overflow-hidden relative md:border-2 border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
        <div className="px-3 py-2 md:px-4 md:py-3 border-b-2 border-slate-200 dark:border-zinc-700 flex items-center gap-2 md:gap-3 sticky top-0 z-10 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm">
          <div className="flex items-center justify-center h-8 w-8">
            <ChefHat size={28} weight="duotone" className="text-emerald-500" />
          </div>

          <div className="flex-1">
            <h2 className="font-semibold text-base">GainChef Assistant</h2>
          </div>

          <button
            type="button"
            onClick={clearAllData}
            title="Clear all data"
            className="text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 p-2 rounded-lg transition-colors"
          >
            <Trash size={18} />
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 p-2 rounded-lg transition-colors"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <div className="px-3 py-2 md:px-4 md:py-3 border-b-2 border-slate-200 dark:border-zinc-700 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-2 md:space-y-3">
          <div className="flex flex-wrap justify-between items-center gap-1 md:gap-2">
            <div>
              <p className="text-[10px] md:text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-semibold">
                Today's Macros
              </p>
              <p className="text-xs md:text-sm font-medium text-slate-700 dark:text-slate-300 hidden md:block">
                Stay on target to hit your goals
              </p>
            </div>
            <span className="text-[10px] md:text-xs text-muted-foreground">
              {connectionStatus}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1.5 md:gap-2">
            {macroCards.map((card) => (
              <Card
                key={card.label}
                className="p-2 md:p-3 flex flex-col gap-0.5 md:gap-1 bg-white dark:bg-zinc-800 border-2 border-slate-200 dark:border-zinc-700 shadow-sm"
              >
                <span className="text-[9px] md:text-xs text-slate-600 dark:text-slate-400 uppercase tracking-wide font-medium">
                  {card.label}
                </span>
                <span className="text-sm md:text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {card.value}
                </span>
              </Card>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 md:gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                handleQuickPrompt("Give me a quick progress check for today")
              }
            >
              Check progress
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                handleQuickPrompt(
                  "Create a high-protein meal plan for the rest of the day"
                )
              }
            >
              Plan my meals
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                handleQuickPrompt(
                  "Generate a shopping list for my current meal plan"
                )
              }
            >
              Shopping list
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 md:p-4 space-y-3 md:space-y-4 pb-20 md:pb-24 bg-slate-50/50 dark:bg-zinc-900/50">
          {agentMessages.length === 0 && (
            <div className="h-full flex items-center justify-center">
              <Card className="p-6 max-w-md mx-auto bg-white dark:bg-zinc-800 border-2 border-slate-200 dark:border-zinc-700 shadow-lg">
                <div className="text-center space-y-4">
                  <div className="bg-emerald-500/10 text-emerald-500 rounded-full p-3 inline-flex">
                    <ChefHat size={24} weight="duotone" />
                  </div>
                  <h3 className="font-semibold text-lg">Welcome to GainChef</h3>
                  <p className="text-muted-foreground text-sm">
                    Plan your meals, log macros, and stay accountable. Try:
                  </p>
                  <ul className="text-sm text-left space-y-2">
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-500">•</span>
                      <span>
                        "Log 40g protein for grilled chicken and rice I just
                        ate"
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-500">•</span>
                      <span>
                        "Set my macro targets to 180p / 220c / 70f and 2600
                        calories"
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-500">•</span>
                      <span>
                        "Build a three-day high-protein meal plan and shopping
                        list"
                      </span>
                    </li>
                  </ul>
                </div>
              </Card>
            </div>
          )}

          {agentMessages.map((m, index) => {
            const isUser = m.role === "user";
            const showAvatar =
              index === 0 || agentMessages[index - 1]?.role !== m.role;

            return (
              <div key={m.id}>
                <div
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`flex gap-2 max-w-[85%] ${
                      isUser ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    {showAvatar && !isUser ? (
                      <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                        <ChefHat
                          size={18}
                          weight="fill"
                          className="text-white"
                        />
                      </div>
                    ) : (
                      !isUser && <div className="w-8" />
                    )}

                    <div>
                      <div>
                        {m.parts?.map((part, i) => {
                          if (part.type === "text") {
                            return (
                              // biome-ignore lint/suspicious/noArrayIndexKey: immutable index
                              <div key={i}>
                                <Card
                                  className={`p-3 rounded-md bg-neutral-100 dark:bg-neutral-900 ${
                                    isUser
                                      ? "rounded-br-none"
                                      : "rounded-bl-none border-assistant-border"
                                  } ${
                                    part.text.startsWith("scheduled message")
                                      ? "border-accent/50"
                                      : ""
                                  } relative`}
                                >
                                  {part.text.startsWith(
                                    "scheduled message"
                                  ) && (
                                    <span className="absolute -top-3 -left-2 text-base">
                                      🕒
                                    </span>
                                  )}
                                  <MemoizedMarkdown
                                    id={`${m.id}-${i}`}
                                    content={part.text.replace(
                                      /^scheduled message: /,
                                      ""
                                    )}
                                  />
                                </Card>
                                <p
                                  className={`text-xs text-muted-foreground mt-1 ${
                                    isUser ? "text-right" : "text-left"
                                  }`}
                                >
                                  {formatTime(
                                    m.metadata?.createdAt
                                      ? new Date(m.metadata.createdAt)
                                      : new Date()
                                  )}
                                </p>
                              </div>
                            );
                          }

                          if (isToolUIPart(part)) {
                            const toolCallId = part.toolCallId;
                            const toolName = part.type.replace("tool-", "");
                            const needsConfirmation =
                              toolsRequiringConfirmation.includes(
                                toolName as keyof typeof tools
                              );

                            return (
                              <ToolInvocationCard
                                // biome-ignore lint/suspicious/noArrayIndexKey: using index is safe here as the array is static
                                key={`${toolCallId}-${i}`}
                                toolUIPart={part}
                                toolCallId={toolCallId}
                                needsConfirmation={needsConfirmation}
                                onSubmit={({ toolCallId, result }) => {
                                  addToolResult({
                                    tool: part.type.replace("tool-", ""),
                                    toolCallId,
                                    output: result
                                  });
                                }}
                                addToolResult={(toolCallId, result) => {
                                  addToolResult({
                                    tool: part.type.replace("tool-", ""),
                                    toolCallId,
                                    output: result
                                  });
                                }}
                              />
                            );
                          }
                          return null;
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Show thinking animation when streaming but no messages yet or last message is from user */}
          {status === "streaming" &&
            (agentMessages.length === 0 ||
              agentMessages[agentMessages.length - 1]?.role === "user") && (
              <div className="flex justify-start px-4">
                <ThinkingAnimation />
              </div>
            )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAgentSubmit(e, {
              annotations: {
                hello: "world"
              }
            });
            setTextareaHeight("auto");
          }}
          className="p-2 md:p-3 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm fixed md:absolute bottom-0 left-0 right-0 z-10 border-t-2 border-slate-200 dark:border-zinc-700 safe-bottom"
        >
          <div className="flex items-center gap-1.5 md:gap-2">
            <div className="flex-1 relative">
              <Textarea
                disabled={pendingToolCallConfirmation}
                placeholder={
                  pendingToolCallConfirmation
                    ? "Respond above..."
                    : "Send a message..."
                }
                className="flex w-full border-2 border-slate-200 dark:border-zinc-700 px-3 py-2 ring-offset-background placeholder:text-slate-400 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 text-base md:text-sm min-h-[40px] md:min-h-[24px] max-h-[120px] md:max-h-[calc(75dvh)] overflow-y-auto resize-none rounded-2xl pb-10 bg-white dark:bg-zinc-800"
                value={agentInput}
                onChange={(e) => {
                  handleAgentInputChange(e);
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight}px`;
                  setTextareaHeight(`${e.target.scrollHeight}px`);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    handleAgentSubmit(e as unknown as React.FormEvent);
                    setTextareaHeight("auto");
                  }
                }}
                rows={2}
                style={{ height: textareaHeight }}
              />
              <div className="absolute bottom-0 right-0 p-2 w-fit flex flex-row justify-end">
                {status === "submitted" || status === "streaming" ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-emerald-500 text-white hover:bg-emerald-600 rounded-full p-1.5 h-fit border border-neutral-200 dark:border-neutral-800"
                    aria-label="Stop generation"
                  >
                    <StopCircle size={16} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-emerald-500 text-white hover:bg-emerald-600 rounded-full p-1.5 h-fit border border-neutral-200 dark:border-neutral-800"
                    disabled={pendingToolCallConfirmation || !agentInput.trim()}
                    aria-label="Send message"
                  >
                    <PaperPlaneRight size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
