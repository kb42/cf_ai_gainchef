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
  ChefHat,
  Microphone,
  Stop
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
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
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
    const storageKey = "gainchef-session-id";
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;

    const newId = crypto.randomUUID();
    localStorage.setItem(storageKey, newId);
    return newId;
  }, []);

  const agent = useAgent({
    agent: "GainChefAgent", // agent class name
    name: sessionId // unique instance per session
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
    setTextareaHeight("auto");

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

  // Transcribe audio using Cloudflare AI (Whisper)
  const transcribeAudio = useCallback(async (audioBlob: Blob) => {
    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob);

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error("Transcription failed");
      }

      const data = (await response.json()) as { text?: string };
      if (data.text) {
        setAgentInput((prev) => `${prev}${data.text} `);
      }
    } catch (error) {
      console.error("Transcription error:", error);
      setRecordingError("Failed to transcribe audio");
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  // Voice recording functionality with fallback for Firefox
  const startRecording = useCallback(() => {
    setRecordingError(null);

    // Try Web Speech API first (Chrome, Safari, Edge)
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      // Use native speech recognition
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onresult = (event) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += `${transcript} `;
          } else {
            interimTranscript += transcript;
          }
        }

        // Update textarea with both final and interim results
        if (finalTranscript) {
          setAgentInput((prev) => prev + finalTranscript);
        } else if (interimTranscript) {
          // Show interim results in real-time
          const currentFinal = agentInput;
          setAgentInput(currentFinal + interimTranscript);
        }
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        setRecordingError(`Error: ${event.error}`);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } else {
      // Fallback to MediaRecorder for Firefox
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          audioChunksRef.current = [];
          const mediaRecorder = new MediaRecorder(stream);

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunksRef.current.push(event.data);
            }
          };

          mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunksRef.current, {
              type: "audio/webm"
            });
            for (const track of stream.getTracks()) {
              track.stop();
            }
            await transcribeAudio(audioBlob);
          };

          mediaRecorder.start();
          mediaRecorderRef.current = mediaRecorder;
          setIsRecording(true);
        })
        .catch((error) => {
          console.error("Microphone access error:", error);
          setRecordingError("Microphone access denied");
        });
    }
  }, [agentInput, transcribeAudio]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setIsRecording(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

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

  // Improved auto-scroll: scroll on new messages and when streaming
  useEffect(() => {
    if (agentMessages.length > 0) {
      // Use requestAnimationFrame for smoother scrolling during streaming
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "end"
        });
      });
    }
  }, [agentMessages]);

  // Additional scroll on status change to ensure we're at bottom during streaming
  useEffect(() => {
    if (status === "streaming") {
      const interval = setInterval(() => {
        messagesEndRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "end"
        });
      }, 100);
      return () => clearInterval(interval);
    }
  }, [status]);

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
          {recordingError && (
            <div className="mb-2 px-3 py-2 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 text-xs rounded-lg">
              {recordingError}
            </div>
          )}
          <div className="flex items-end gap-1.5 md:gap-2">
            {/* Microphone button */}
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={pendingToolCallConfirmation || isTranscribing}
              className={`inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 rounded-full p-2.5 md:p-2 h-fit border-2 min-w-[44px] md:min-w-[36px] ${
                isRecording
                  ? "bg-red-500 text-white hover:bg-red-600 border-red-400 dark:border-red-600 animate-pulse"
                  : isTranscribing
                    ? "bg-blue-500 text-white border-blue-400 dark:border-blue-600 animate-pulse"
                    : "bg-white dark:bg-zinc-800 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border-emerald-500 dark:border-emerald-600"
              }`}
              aria-label={
                isRecording
                  ? "Stop recording"
                  : isTranscribing
                    ? "Transcribing..."
                    : "Start voice input"
              }
            >
              {isRecording ? (
                <Stop size={20} weight="fill" />
              ) : (
                <Microphone size={20} weight="fill" />
              )}
            </button>

            <div className="flex-1 relative">
              <Textarea
                disabled={pendingToolCallConfirmation || isTranscribing}
                placeholder={
                  isTranscribing
                    ? "Transcribing..."
                    : isRecording
                      ? "Listening..."
                      : pendingToolCallConfirmation
                        ? "Respond above..."
                        : "Send a message..."
                }
                className={`flex w-full border-2 px-3 py-2 ring-offset-background placeholder:text-slate-400 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 text-base md:text-sm min-h-[44px] md:min-h-[40px] max-h-[120px] md:max-h-[calc(75dvh)] overflow-y-auto resize-none rounded-2xl pr-12 bg-white dark:bg-zinc-800 ${
                  isRecording
                    ? "border-red-400 dark:border-red-600 ring-2 ring-red-300 dark:ring-red-800"
                    : "border-slate-200 dark:border-zinc-700"
                }`}
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
                rows={1}
                style={{ height: textareaHeight }}
              />
              <div className="absolute bottom-1 right-1 flex flex-row gap-1">
                {status === "submitted" || status === "streaming" ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-red-500 text-white hover:bg-red-600 rounded-full p-2 h-fit border border-red-400 dark:border-red-600 min-w-[40px] min-h-[40px]"
                    aria-label="Stop generation"
                  >
                    <StopCircle size={18} weight="fill" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-emerald-500 text-white hover:bg-emerald-600 disabled:bg-slate-300 dark:disabled:bg-zinc-700 rounded-full p-2 h-fit border border-emerald-400 dark:border-emerald-600 min-w-[40px] min-h-[40px]"
                    disabled={pendingToolCallConfirmation || !agentInput.trim()}
                    aria-label="Send message"
                  >
                    <PaperPlaneRight size={18} weight="fill" />
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
