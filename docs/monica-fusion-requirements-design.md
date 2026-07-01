# Monica Internal Fusion Requirements and Design

Date: 2026-07-01
Status: Draft

## Background

Monica Multi-Model Compare currently intercepts Monica Web chat requests, clones the captured request body, changes `data.use_model` and the question item's `data.chat_model`, then replays the request for selected extra models. The current implementation is useful for side-by-side comparison, but it still leaves the user to manually read and reconcile multiple answers.

OpenRouter Fusion provides a useful reference shape: run the same prompt through a panel of models, have a judge compare panel answers, extract consensus, contradictions, partial coverage, unique insights, and blind spots, then produce a final answer. Official references:

- Fusion Router: https://openrouter.ai/docs/guides/routing/routers/fusion-router
- Fusion Server Tool: https://openrouter.ai/docs/guides/features/server-tools/fusion
- Fusion announcement: https://openrouter.ai/blog/announcements/fusion-beats-frontier/

This project should implement the same product idea inside Monica first, without requiring OpenRouter API keys or sending data outside Monica.

## Goals

1. Add a Monica-native Fusion-like mode on top of the existing multi-model replay flow.
2. Use Monica's available model pool as the panel, especially models that are effectively free for the user to run.
3. Preserve the existing Shadow DOM side panel as the primary UI surface.
4. Support think and non-think model output differences without leaking hidden or intermediate reasoning into the judge prompt.
5. Keep Monica compatibility risk low by avoiding deep insertion into Monica's native conversation DOM for the first version.
6. Make the feature testable with the existing Playwright/CDP test harness.

## Non-Goals

1. Do not implement official OpenRouter Fusion in the first version.
2. Do not require an OpenRouter API key.
3. Do not attempt to make `openrouter/fusion` a Monica `use_model`; Monica's backend is unlikely to accept OpenRouter model slugs.
4. Do not write the Fusion summary back into Monica's native chat transcript in the first version.
5. Do not depend on Monica's visible DOM structure beyond the existing input and request interception points.

## Target Panel Models

The default Fusion panel should be:

- Gemini 3.5 Flash, think model
- GPT 5.5, think model
- Claude 4.6 Sonnet, non-think model

The exact Monica IDs must be confirmed by packet capture before relying on them. The current guessed/default shape is:

| Display name | Expected `use_model` | Expected `chat_model` | UI mode |
| --- | --- | --- | --- |
| Gemini 3.5 Flash (Think) | `gemini-3.5-flash` | `gemini_3_5_flash` | think |
| GPT 5.5 (Think) | `gpt-5.5` | `gpt_5_5` | think |
| Claude 4.6 Sonnet | `claude-sonnet-4-6` | `claude_4_6_sonnet` | non-think |

Opus and GPT Pro-level models should stay opt-in because they may have different cost or quota behavior.

## User Requirements

1. Users can enable or disable Fusion mode independently from plain multi-model compare.
2. Users can choose the panel models from the existing extra model list.
3. Users can choose a judge model. Default: Claude 4.6 Sonnet or the strongest non-premium model that proves stable in testing.
4. Users can choose whether Fusion runs automatically after all panel models finish.
5. Users can manually run, retry, and copy the Fusion summary.
6. Users can keep auto-reload disabled while still seeing all panel outputs and the Fusion summary in the plugin side panel.
7. Users can inspect failures per model without blocking successful models.

## Functional Requirements

### Request Capture and Replay

The existing request interception remains the entry point:

1. Capture the original Monica chat request.
2. Determine the original model from `body.data.use_model`.
3. Build replay requests for selected panel models, excluding the original model if it is already in the panel.
4. Replay panel requests sequentially by default to reduce Monica error 11136 risk.
5. Preserve the current request mutation rules:
   - update `data.use_model`
   - update question item `data.chat_model`
   - generate a new `task_uid`
   - generate a new `data.pre_generated_reply_id`
   - keep the parent question relationship compatible with Monica's grouped reply behavior

### Stream Normalization

Add a normalization layer before writing chunks to the UI:

```js
normalizeStreamEvent(rawEvent) => {
  finalText: string,
  thinkingText: string,
  status: 'waiting' | 'thinking' | 'answering' | 'done' | 'error',
  error: string | null
}
```

The first implementation should support the current `d.text` and `d.error` fields. It should also be ready to map future Monica fields such as `thinking`, `reasoning`, `reasoning_text`, `content`, or phase/status markers after live packet capture confirms them.

Only `finalText` is eligible for the Fusion judge prompt. `thinkingText` can be shown collapsed in the UI later, but should not be included in synthesis. This avoids treating model-private or intermediate reasoning UI as source material.

### Fusion Collection

Each panel record should store:

```js
{
  modelId,
  modelLabel,
  uiMode: 'think' | 'non-think' | 'unknown',
  finalText,
  thinkingText,
  status,
  error,
  startedAt,
  finishedAt
}
```

Fusion can run when at least two panel models have non-empty `finalText`. If only one model succeeds, the UI should mark Fusion as skipped and explain that there were not enough answers to synthesize.

### Judge Request

The judge request should be another Monica replay request using the selected judge model, but with a synthetic user prompt that contains:

1. The original user question.
2. The model panel answers.
3. The judge rubric.
4. Explicit instructions to ignore intermediate thinking output.

The first version should display the judge response only in the plugin's Fusion panel. It may still create a Monica backend request and may appear in Monica history depending on how Monica stores custom bot requests; this must be observed in testing.

## Fusion Judge Prompt

The prompt should be adapted from OpenRouter's public behavior and the community OMP Fusion rubric. Community reference:

- https://github.com/jms830/omp-fusion

Recommended prompt template:

```text
You are the Fusion judge for Monica Multi-Model Compare.

You receive the original user task and several model answers. The answers were produced independently. You did not write any of them, so you are a neutral synthesizer.

Important rules:
- Do not vote, average, or paste the answer you like best.
- Do not invent agreement. If only one model said something, mark it as lower confidence unless the evidence is strong.
- Do not smooth over contradictions. Surface them clearly.
- Do not use hidden reasoning, thinking traces, status text, or intermediate reasoning UI as evidence. Use only the final visible answers provided below.
- If the panel consensus looks unsafe or weak, say so.
- If fewer than two substantial answers are available, say that synthesis is limited.

First classify the task:
- Artifact/code task: compare the candidates, identify which parts are usable, explain what still needs verification, and produce one merged recommendation or artifact.
- Research/analysis task: write the following sections.

For research/analysis tasks, use this structure:
1. Final answer
2. Consensus
3. Contradictions
4. Partial coverage
5. Unique insights
6. Blind spots and residual uncertainty

Lead with the answer the user wanted. Keep the audit sections concise but specific.

Original user task:
{{USER_TASK}}

Panel answers:
{{PANEL_ANSWERS}}
```

The final prompt should be assembled in code from stable template fragments, not built through ad hoc concatenation scattered across the replay logic.

## UI Design

Use the existing Shadow DOM side panel. The first version should make the smallest compatible UI change:

1. Keep one model panel per replayed model.
2. Add one persistent `Fusion Summary` panel below the model panels.
3. Add compact actions in the Fusion panel header:
   - Run
   - Retry
   - Copy
4. Add settings:
   - Enable Fusion
   - Auto-run Fusion after panel responses
   - Judge model
   - Include failed model diagnostics in judge prompt

The Fusion panel statuses should be:

- `waiting`: no panel responses yet
- `collecting`: panel models are still running
- `ready`: enough final answers are available
- `judging`: judge request is running
- `done`: Fusion summary complete
- `skipped`: not enough successful answers
- `error`: judge request failed

Avoid tabs, complex nested cards, and Monica DOM insertion for the first version. A single additional panel is easier to keep compatible with Monica page changes and the current test harness.

## Monica Compatibility Notes

### Stable Boundaries

The safest boundaries are:

- network request interception
- cloned request mutation
- Shadow DOM panel rendering
- hidden DOM status element for page/userscript context communication

### Risky Boundaries

These should be avoided in the first version:

- injecting Fusion content into Monica's native message list
- relying on Monica CSS classes
- relying on Monaco-specific visible thinking UI DOM
- assuming guessed model IDs are correct without packet capture

### Think vs Non-Think Models

Think models may stream or store intermediate reasoning differently from non-think models. The implementation should not assume every useful token arrives as `d.text`. It should observe and normalize stream events before rendering or judging.

Initial rule:

- render final answer text normally
- track thinking/status separately if present
- exclude thinking/status from the judge prompt
- show model UI mode in the panel label for debugging

## Error Handling

1. If a panel model errors, keep its panel and mark it as failed.
2. If at least two panel models succeed, Fusion can still run.
3. If all panel models fail, Fusion is skipped.
4. If the judge request fails, keep panel outputs and show a retry action.
5. If Monica returns error 11136, show it as a service/rate-limit condition and keep sequential replay behavior.
6. If the request body shape changes, fail gracefully and show the last captured request debug action.

## Test Plan

### Unit-Level Tests

1. `normalizeStreamEvent` handles:
   - current `{ text }` chunks
   - `{ error }`
   - empty chunks
   - future thinking/reasoning-shaped fields once captured
2. Fusion prompt builder:
   - includes original user task
   - includes only final panel text
   - excludes thinking text
   - includes failed model diagnostics only when enabled
3. Fusion readiness:
   - skips with zero or one successful answer
   - runs with two or more successful answers

### Browser Tests

Extend `test/test-all.js`:

1. Verify the three target models are covered:
   - Gemini 3.5 Flash (think)
   - GPT 5.5 (think)
   - Claude 4.6 Sonnet (non-think)
2. Verify model panels show output in the Shadow DOM.
3. Verify the Fusion panel appears.
4. Verify Fusion reaches `done` or a clear `skipped/error` state.
5. Verify auto-reload remains optional and defaults off.
6. Verify the plugin UI survives page refresh.

### Manual Packet Capture

Before coding against think model fields, capture and save examples for:

1. Gemini 3.5 Flash streaming response.
2. GPT 5.5 streaming response.
3. Claude 4.6 Sonnet streaming response.
4. A judge request and response.

Store sanitized captures under `test/fixtures/` so future parsing changes can be tested without live Monica calls.

## Implementation Sequence

1. Confirm Monica IDs for the target models through packet capture.
2. Add model metadata fields: `uiMode`, optional `isJudgeCandidate`, optional `costTier`.
3. Add stream normalization and panel output storage.
4. Add Fusion state and `Fusion Summary` panel.
5. Add judge prompt builder.
6. Add judge replay flow using the selected Monica model.
7. Add settings controls.
8. Add fixture-based parser tests.
9. Extend Playwright/CDP tests for Fusion behavior.

## Open Questions

1. Which exact Monica model IDs correspond to Gemini 3.5 Flash and GPT 5.5?
2. Should the default judge be Claude 4.6 Sonnet or a stronger but still free model?
3. Does Monica store the synthetic judge request in the native conversation history?
4. Can Monica judge requests be tagged or shaped so they do not confuse the native conversation?
5. What exact stream fields carry thinking vs final answer text for each think model?

## Recommended First Version

Build the feature as side-panel-only Fusion:

1. Use the three target Monica models as panel members.
2. Run panel requests sequentially.
3. Store normalized final answer text.
4. Auto-run Fusion only when enabled.
5. Display the Fusion summary in a new Shadow DOM panel.
6. Keep native Monica conversation mutation out of scope.

This gives the user the practical value of Fusion while keeping the integration inside the parts of Monica that the current script already controls.
