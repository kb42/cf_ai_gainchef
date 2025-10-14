import { Sparkle } from "@phosphor-icons/react";

export function ThinkingAnimation() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-slate-100 dark:bg-zinc-800 rounded-xl border-2 border-slate-200 dark:border-zinc-700">
      <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 animate-pulse">
        <Sparkle size={18} weight="fill" className="text-white" />
      </div>
      <div className="flex items-center gap-1.5">
        <div className="text-sm text-muted-foreground">Thinking</div>
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0ms]"></span>
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:150ms]"></span>
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:300ms]"></span>
        </div>
      </div>
    </div>
  );
}
