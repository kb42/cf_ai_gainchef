import type { UIMessage } from "ai";
import { isToolUIPart } from "ai";

// tiny helper to skip half-baked tool calls
export function cleanupMessages(messages: UIMessage[]): UIMessage[] {
  return messages.filter((message) => {
    if (!message.parts) return true;

    const hasIncompleteToolCall = message.parts.some((part) => {
      if (!isToolUIPart(part)) return false;
      return part.state === "input-streaming";
    });

    return !hasIncompleteToolCall;
  });
}
