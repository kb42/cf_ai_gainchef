# GainChef – Cloudflare Agents Nutrition Coach

GainChef is a Workers AI powered meal coach that tracks macros, stores meal history, and delivers AI-planned menus using Cloudflare Agents, Durable Objects, Workflows, and a Vite/React frontend.

## What’s inside

- Workers AI (default: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`) with automatic fallback to a lighter model when tools aren’t supported
- Durable Object state for user profiles, meal logs, meal plans, and shopping lists
- Cloudflare Workflows for scheduled reminders and summaries
- React UI with macros dashboard, one-click prompts, and tool invocation cards

## Prerequisites

- Node.js 18 or later
- A Cloudflare account with Workers, Durable Objects (D1 mode), Workflows, and Workers AI enabled
- Wrangler logged in locally (`npm exec wrangler -- login`)

## Quick start

```bash
git clone <your-repo-url>
cd cf_ai_gainchef
npm install
```

### Recommended dev workflow

1. **Add OpenAI API Key (or an AI of your choice) to .dev.vars**

2. **Run type/lint checks**
   ```bash
   npm run check
   ```
3. **Run unit tests (Workers runtime)**
   ```bash
   npm run test
   ```
4. **Start the frontend**
   ```bash
   npm run start
   ```
5. **In a second terminal, run the Worker against Cloudflare’s edge GPUs**
   ```bash
   npm exec wrangler -- dev --remote
   ```
6. Visit `http://localhost:5173` to chat with GainChef. The UI talks to the Worker on port `8787`, which streams responses and persists state.

### Everyday commands

| Command                             | Purpose                                                          |
| ----------------------------------- | ---------------------------------------------------------------- |
| `npm run start`                     | Launch Vite for the React UI                                     |
| `npm exec wrangler -- dev --remote` | Run the Worker in remote dev mode (needed for Workers AI access) |
| `npm run check`                     | Format + lint + type-check (`prettier`, `biome`, `tsc`)          |
| `npm run test`                      | Vitest suite (covers routing, workflow triggers, storage)        |
| `npm run deploy`                    | Build frontend and deploy Worker + assets via Wrangler           |

## Deployment notes

1. `npm exec wrangler -- login`
2. `npm run deploy`
3. (Optional) `wrangler workflows deploy` if you change `MealPrepWorkflow`

Set `AI`, `GainChefAgent`, and `MEAL_PREP` bindings in `wrangler.jsonc` to match your Cloudflare account. `npm run types` regenerates `env.d.ts` with those bindings.

## Repository layout

```
├── public/              static assets served by Workers
├── src/
│   ├── app.tsx          main React entry (chat experience)
│   ├── server.ts        durable object agent + Worker routes
│   ├── tools.ts         tool definitions invoked by the LLM
│   ├── workflow.ts      Cloudflare Workflows entrypoint
│   ├── utils.ts         helper for cleaning tool-call noise
│   └── types.ts         shared domain models
├── tests/               Vitest suites (Workers test harness)
├── wrangler.jsonc       bindings for AI, Durable Object, workflows, assets
└── README.md            this file
```

## Extending GainChef

- Add tools in `src/tools.ts` (return plain text so the fallback model can respond without tool support)
- Store new entities by adding helpers to `GainChefAgent`
- Enrich Workflows in `src/workflow.ts` to send notifications or run batch planning
- Tweak UI components (macros dashboard, tool cards) in `src/app.tsx` and `src/components`

---

Questions or ideas? Fire up `npm run start`, chat with the agent, and iterate. Happy building!
