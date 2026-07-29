# Fusion Prompt Research and Evaluation

Date: 2026-07-29

## Outcome

The recommended default is **Evidence-led v3.2**: keep Monica's current one-pass aggregation flow, anonymize the candidate answers, and make the aggregator normalize and audit atomic claims before independently structuring one final answer.

This design deliberately does not add a peer-review round yet. Anonymous peer review can improve hard factual or strategic tasks, but it roughly doubles panel calls before the final synthesis. Evidence-led v3.2 adds hard safeguards for central time-sensitive claims, candidate-order and narrative bias, source verification, entity conflicts, and literal proofreading without increasing request count or Monica quota use.

## Open-source patterns reviewed

Star counts are a point-in-time snapshot from the GitHub API on 2026-07-29.

| Project | Stars | Relevant pattern | Fusion takeaway |
| --- | ---: | --- | --- |
| [karpathy/llm-council](https://github.com/karpathy/llm-council) | 23,327 | Independent answers, anonymous peer ranking, chairman synthesis | Hide model identity; inspect candidates independently before synthesis |
| [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | 23,724 | Explicit rubrics, deterministic checks first, model grading only where needed | Define task-specific success criteria and test prompts against a stable rubric |
| [togethercomputer/MoA](https://github.com/togethercomputer/MoA) | 2,956 | Several reference models followed by a critical aggregator | Treat references as possibly biased or incorrect; refine instead of copying |
| [yuchenlin/LLM-Blender](https://github.com/yuchenlin/LLM-Blender) | 990 | Pairwise ranking followed by generative fusion | Separate candidate assessment from final generation |
| [Skytliang/Multi-Agents-Debate](https://github.com/Skytliang/Multi-Agents-Debate) | 599 | Explicit disagreement and debate | Preserve useful minority claims instead of forcing consensus |

Large orchestration frameworks such as [microsoft/autogen](https://github.com/microsoft/autogen) and [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) are popular, but their general agent architecture is less directly useful than the focused fusion projects above.

## Community signals from Reddit

These are practitioner signals, not controlled evidence:

- A highly upvoted [r/LocalLLaMA prompting discussion](https://www.reddit.com/r/LocalLLaMA/comments/1efqhj7/what_are_the_most_mind_blowing_prompting_tricks/) recommends a decompose → hypothesize → criticize → synthesize → reflect pattern. For Fusion, the useful portion is internal critique followed by synthesis; forcing a visible reflection section makes ordinary answers noisy.
- A [LocalLLaMA council discussion](https://www.reddit.com/r/LocalLLaMA/comments/1r4s3oj/forking_llmcouncil_for_pure_local_setups_using/) distinguishes factual verification from decision support: consensus works well for verification, while deliberately different perspectives improve strategy and tradeoff questions.
- A [ClaudeCode council discussion](https://www.reddit.com/r/ClaudeCode/comments/1tqcy13/the_llm_council_stop_asking_ai_one_question_ask/) emphasizes anonymous review so a confident or prestigious model identity does not dominate.
- A [creative-writing judge discussion](https://www.reddit.com/r/LocalLLaMA/comments/1jieg3u/creative_writing_judged_by_other_models/) reports that one broad scalar judgment is unstable and suggests narrower boolean criteria. Fusion should therefore extract explicit task constraints instead of using a vague "best answer" instruction alone.

## Prompt candidates

### Candidate A — Minimal critical aggregator

```text
Synthesize the candidate answers into one accurate, complete answer to the original task.
Treat every candidate as potentially wrong. Do not vote or copy one answer wholesale.
Resolve contradictions, preserve useful minority details, and state consequential uncertainty.
Return only the final answer in the user's language and requested format.
```

Strength: short and inexpensive. Weakness: leaves "accurate" and "complete" underspecified, so results can favor confident prose.

### Candidate B — Evidence-led v2 (recommended)

```text
Extract the original task's deliverable, constraints, language, format, and success criteria.
Assess each anonymous candidate independently against that contract.
Reconcile at claim level: agreement is a signal, not proof; retain supported minority insights,
discard repeated errors, and never merge incompatible claims.
Draft one answer and verify it against every explicit constraint.
```

Strength: improves reliability within the existing one-call architecture. It also supports factual, code, decision, and creative tasks without forcing the same visible outline on all of them.

### Candidate C — Full council

```text
Round 1: collect independent answers.
Round 2: show anonymized answers to every panel member for criterion-based critique.
Round 3: give the chairman the original answers and critiques for final synthesis.
```

Strength: strongest disagreement signal. Weakness: substantially more latency, quota use, and failure surface. This should be a future optional "Deep Fusion" mode, not the default.

## Regression examples

Use the same panel models and judge for every candidate prompt. Disable cache and keep sampling settings stable where Monica exposes them.

### Example 1 — Factual conflict

User task:

```text
Python dictionaries preserve insertion order. In which Python version did this become a language guarantee, and what was true in CPython 3.6?
```

Expected qualities:

- distinguishes the CPython 3.6 implementation detail from the Python 3.7 language guarantee;
- does not use majority vote if two candidates repeat the same wrong version;
- answers directly without an unnecessary Fusion audit.

### Example 2 — Executable artifact

User task:

```text
Write a PostgreSQL migration that adds a non-null `created_at` column to a 50M-row production table with minimal blocking. Include rollback and verification steps.
```

Expected qualities:

- produces an actionable staged migration rather than a comparison of candidates;
- does not blindly combine incompatible transaction or locking advice;
- flags version- or environment-dependent claims that require verification.

### Example 3 — Decision with real tradeoffs

User task:

```text
For a six-person team with one backend service and moderate growth, should we move from a modular monolith to microservices this year? Give a decision, triggers to revisit it, and a 90-day plan.
```

Expected qualities:

- makes a decision using the stated team context;
- preserves legitimate minority risks and counterarguments;
- separates factual constraints from judgment;
- follows all three requested deliverables.

### Example 4 — Perspective-bound identity

User task:

```text
你是什么模型？请告诉我你的确切模型名称。
```

Expected qualities:

- does not merge Gemini, GPT, and Claude self-reports into one false identity;
- does not adopt a candidate's identity as the Fusion judge's own;
- explains succinctly when the available panel answers cannot establish one shared identity.

## Scoring rubric

Score each output from 0–4 on:

1. Correctness and claim discipline.
2. Coverage of the task contract.
3. Contradiction handling and minority-insight preservation.
4. Actionability or fit to the requested artifact.
5. Calibration: no invented facts, citations, consensus, or identity.
6. Output quality: direct, coherent, and free of fusion-process leakage.

Use deterministic checks first (required sections, code syntax, explicit constraints). Use a blind model judge only for the remaining qualitative dimensions, and randomize displayed output order to reduce position bias.

## Recommendation

Ship Evidence-led v3.2 now. Consider Full Council later as an opt-in Deep Fusion mode for high-value research and decisions, with explicit quota and latency warnings.
