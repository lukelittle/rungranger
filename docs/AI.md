# Adding an optional Claude assistant to RungRanger

**Status: documentation only. Nothing in this repository calls an AI service.**

RungRanger is complete without AI. The editor, simulator, validation, cross reference and project storage all run locally in the browser, and the PLC engine never asks a model what to do. This guide is for contributors or schools who want to add an *optional* Claude-powered tutor later. It explains what such an assistant could do, where it would plug in, and the security rules it must follow.

## 1. What an assistant could do

| Feature | User action | What Claude receives | What comes back |
| --- | --- | --- | --- |
| **Explain this rung** | Right-click a rung, then *Explain* | The rung as mnemonic text, its comment, the symbols it uses and (if online) live values | A plain-language description that refers to addresses and symbols |
| **Instruction tutor** | *Ask about TON…* in Instruction Help | The mnemonic, RungRanger's own help text and the learner's question | An explanation at beginner or experienced level |
| **Troubleshoot** | "Why won't my motor start?" | The symptom, Verify diagnostics, fault info and a live data snapshot | Likely causes, each tied to a rung and an address, plus what to check in the data table |
| **Suggest a change** | "Add a 5 second start delay" | The program as rung text and the symbol table | One or more *proposals* in rung text, never applied automatically |

## 2. Non-negotiable rules

1. **The core stays AI-free.** Code in `src/core`, `src/runtime`, `src/persistence` and `src/equipment` must never import assistant code. The simulator must behave identically whether or not an assistant is configured.
2. **Never ship a shared API key.** RungRanger is deployed as a public static site, so anything in the bundle, including values baked in by Vite `import.meta.env`, is public. Obfuscation does not help.
3. **Proposals are only proposals.** Any suggested edit is parsed with `parseRungText` (`src/core/ascii.ts`) and checked with `validateProject` (`src/core/validate.ts`). It is shown to the user as a before/after diff and applied only if they click *Accept*, through the normal `edit()` path so that it can be undone. Nothing goes to the virtual controller without the usual download/online-edit checks.
4. **Opt-in and transparent.** Assistance is off by default. Before each request the user can see exactly what will be sent: program text, comments, symbols and live values.
5. **The tutor is not a safety authority.** The tutor's answers carry the same caveat as the simulator: they are educational and are not for validating real machinery.

## 3. Architecture

```
 Browser (static site, GitHub Pages)            Your server (holds the key)          Anthropic API
 ┌───────────────────────────────┐   HTTPS    ┌──────────────────────────┐  HTTPS  ┌──────────────┐
 │ RungRanger UI                 │ ─────────► │ /api/tutor proxy         │ ──────► │ Messages API │
 │  • builds context (rung text) │   JSON     │  • authenticates users   │         │ (Claude)     │
 │  • shows answer / diff        │ ◄───────── │  • rate limits, logging  │ ◄────── │              │
 └───────────────────────────────┘            │  • ANTHROPIC_API_KEY env │         └──────────────┘
                                              └──────────────────────────┘
```

There are two acceptable ways to supply credentials:

- **Self-hosted proxy (recommended).** A school, makerspace or individual runs a small backend that keeps `ANTHROPIC_API_KEY` server-side and applies its own login, quotas and logging. RungRanger is configured only with the proxy URL (for example in a settings dialog), never with the key.
- **Bring your own key.** A user pastes their *own* key into a settings dialog. The key stays only in that browser (ideally `sessionStorage`), is sent only to the endpoint the user chose, and is never included in exported project JSON. The UI must say clearly where the key is stored and how to remove it. Because browser-held keys are easy to leak, prefer the proxy.

## 4. Suggested contract (TypeScript)

If you build this, add it under a new `src/ai/` folder. The UI talks only to this interface, so a "none" implementation can be the default.

```ts
import type { Diagnostic } from '../core/validate';
import type { Mnemonic, Project } from '../core/types';

export interface LiveContext {
  mode: string;                       // RUN / PROGRAM / FAULT …
  values: Record<string, number>;     // e.g. { "I:1/0": 1, "T4:0.ACC": 3 }
  fault?: { code: number; message: string; rung: number | null };
}

export interface ProposedChange {
  summary: string;
  rungEdits: { op: 'replace' | 'insert' | 'delete'; rungIndex: number; rungText?: string; comment?: string }[];
  dataEdits?: { address: string; value: number }[];
  symbolEdits?: { address: string; symbol: string; description: string }[];
}

export interface AssistantAnswer {
  text: string;
  references?: { rung?: number; address?: string }[]; // for highlighting in the ladder
}

export interface LadderAssistant {
  isAvailable(): Promise<boolean>;
  explainRung(project: Project, rungIndex: number, live?: LiveContext): Promise<AssistantAnswer>;
  tutorInstruction(mnemonic: Mnemonic, question: string, level: 'beginner' | 'experienced'): Promise<AssistantAnswer>;
  troubleshoot(project: Project, symptom: string, diagnostics: Diagnostic[], live?: LiveContext): Promise<AssistantAnswer>;
  proposeModification(project: Project, request: string): Promise<ProposedChange[]>;
}
```

The browser implementation of this interface only `fetch`es your proxy. It never imports the Anthropic SDK and never sees a key.

## 5. Building the prompt context

Send rungs in RungRanger's mnemonic text, produced by `formatRungText` in `src/core/ascii.ts`. It is compact and unambiguous, and anything Claude proposes in the same notation can be parsed back and validated:

```
Rung 0 — MOTOR SEAL-IN. The STOP button and the overload contact are wired normally closed…
XIC I:1/1 XIC I:1/2 XIO B3:0/0 BST XIC I:1/0 NXB XIC O:2/0 BND OTE O:2/0

Symbols:
I:1/0 START_PB  Start push button (N.O., momentary)
I:1/1 STOP_PB   Stop push button (N.C., ON when not pressed)
…
Live values: I:1/1=1 I:1/2=1 B3:0/0=0 O:2/0=0
```

Context to include in the system prompt:

- RungRanger's addressing conventions (the table in the README) and the instruction help text from `src/core/instructions.ts`, so that explanations match what the simulator actually does.
- The simulator's documented limitations, and a statement that it is not an exact emulation of any real controller.
- The output format for proposals: rung text only, using the same mnemonics, with no instructions RungRanger doesn't support.

Keep the system prompt and instruction reference identical between requests so that prompt caching can reuse them. Put the per-request program and question last.

## 6. Example proxy (server-side, Node + TypeScript)

This is a minimal sketch of the server half. It uses the official Anthropic TypeScript SDK (`npm install @anthropic-ai/sdk`) and runs on *your* server, not in RungRanger's bundle. Add your own authentication and rate limiting before exposing it.

```ts
// server/tutor.ts — runs on a server you control; ANTHROPIC_API_KEY is set in its environment.
import Anthropic from '@anthropic-ai/sdk';
import express from 'express';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
const app = express();
app.use(express.json({ limit: '200kb' }));

const SYSTEM_PROMPT = `You are a patient ladder-logic tutor inside RungRanger, an educational
PLC simulator that uses classic file-based addressing (I:, O:, B3, T4, C5, N7, F8). Explain using the user's addresses and symbols. Rungs use mnemonic
text (XIC, XIO, OTE, OTL, OTU, TON, TOF, RTO, RES, CTU, CTD, MOV, EQU, NEQ, LES, GRT, ADD, SUB;
BST/NXB/BND for branches). The simulator is not an exact emulation of real hardware; never present
answers as safety guidance for real machinery.`;

app.post('/api/tutor', async (req, res) => {
  // TODO: authenticate the caller and enforce per-user quotas here.
  const { question, context } = req.body as { question: string; context: string };
  try {
    const response = await client.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `${context}\n\nQuestion: ${question}` }],
    });
    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: 'The assistant declined this request.' });
      return;
    }
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
    res.json({ text });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) res.status(429).json({ error: 'Busy, try again shortly.' });
    else if (err instanceof Anthropic.APIError) res.status(502).json({ error: `Upstream error ${err.status}` });
    else res.status(500).json({ error: 'Unexpected error' });
  }
});

app.listen(8787);
```

Notes:

- `claude-opus-5-5` was the current default model when this guide was written. Check Anthropic's model documentation for newer options, and choose a model based on cost and quality for your audience.
- Always check `stop_reason` before reading the content.
- For long answers shown as they are generated, use the SDK's streaming API on the server and relay the chunks to the browser (for example with Server-Sent Events).
- The proxy must set CORS to allow only your RungRanger origin.
- Log requests for abuse prevention, but be careful about storing learners' programs. Tell users what you retain.

## 7. Turning proposals into safe edits

1. Ask Claude to return proposals as JSON matching `ProposedChange`. You can enforce the format with structured outputs on the server.
2. In the browser, run every `rungText` through `parseRungText`. Reject the whole proposal if any rung fails to parse.
3. Apply the proposal to a *copy* of the project and run `validateProject`. Show the errors and warnings next to the diff.
4. If the user accepts, apply it with a single `edit()` call so that one Ctrl+Z reverts the whole change.
5. If the controller is online, the change goes through the usual online-edit path: it is applied only if it verifies, and otherwise the previous program keeps running.

## 8. Testing an assistant without a network

- Write a fake `LadderAssistant` that returns canned answers and proposals, and use it in Vitest and Playwright tests.
- Unit-test the context builder: given an example project, assert the exact rung text and symbols it produces.
- Unit-test proposal handling with malformed rung text, unsupported instructions, invalid addresses and proposals that would create Verify errors. All of them must be rejected or flagged before reaching the project.

## 9. Privacy checklist

- [ ] The assistant is disabled until the user turns it on.
- [ ] A preview shows exactly what will be sent.
- [ ] No key is in the repository, the build output or exported projects.
- [ ] The proxy restricts CORS, authenticates callers and rate-limits.
- [ ] A clear notice says the assistant can be wrong and that answers are educational only.
