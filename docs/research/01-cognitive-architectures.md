# Track 1: Cognitive Architectures & Control Loops

> **Scope:** Literature through mid-2026. Confidence tags: **[HIGH]**, **[MED]**, **[LOW]**. Fast-moving numbers are date-stamped.

---

## Table of Contents

1. [Reference List](#1-reference-list)
2. [CoALA — Cognitive Architectures for Language Agents](#2-coala)
3. [ReAct — Reasoning + Acting](#3-react)
4. [Reflexion — Verbal Reinforcement Learning](#4-reflexion)
5. [Self-Refine — Iterative Self-Feedback](#5-self-refine)
6. [Tree of Thoughts and Graph of Thoughts](#6-tot-and-got)
7. [Plan-and-Execute / Task Planning with LLMs](#7-plan-and-execute)
8. [ReWOO — Decoupled Reasoning](#8-rewoo)
9. [LATS — Language Agent Tree Search](#9-lats)
10. [Voyager — Open-Ended Skill Acquisition](#10-voyager)
11. [The "Can LLMs Plan?" Debate](#11-can-llms-plan)
12. [The Perceive-Plan-Act-Observe Loop as Governance Structure](#12-ppao-loop)
13. [Harness-Level Governance](#13-harness-governance)
14. [Key Tensions and Open Questions](#14-key-tensions)

---

## 1. Reference List

| # | Authors | Title | Venue / arXiv | Year | URL |
|---|---------|-------|---------------|------|-----|
| [1] | Sumers, Yao, Narasimhan, Griffiths | Cognitive Architectures for Language Agents (CoALA) | TMLR (v3 2024), arXiv:2309.02427 | 2023 | https://arxiv.org/abs/2309.02427 |
| [2] | Yao, Zhao, Yu, Gordon, Narasimhan, Shafran | ReAct: Synergizing Reasoning and Acting in Language Models | ICLR 2023, arXiv:2210.03629 | 2022/2023 | https://arxiv.org/abs/2210.03629 |
| [3] | Shinn, Cassano, Labash, Gopinath, Narasimhan, Yao | Reflexion: Language Agents with Verbal Reinforcement Learning | NeurIPS 2023, arXiv:2303.11366 | 2023 | https://arxiv.org/abs/2303.11366 |
| [4] | Madaan et al. | Self-Refine: Iterative Refinement with Self-Feedback | NeurIPS 2023, arXiv:2303.17651 | 2023 | https://arxiv.org/abs/2303.17651 |
| [5] | Yao, Yu, Zhao, Shafran, Griffiths, Cao, Narasimhan | Tree of Thoughts: Deliberate Problem Solving with LLMs | NeurIPS 2023, arXiv:2305.10601 | 2023 | https://arxiv.org/abs/2305.10601 |
| [6] | Besta et al. | Graph of Thoughts: Solving Elaborate Problems with LLMs | AAAI 2024, arXiv:2308.09687 | 2023 | https://arxiv.org/abs/2308.09687 |
| [7] | Xu, Hong, Chen, Dong, Chen, Tang | ReWOO: Decoupling Reasoning from Observations for Efficient Augmented LMs | arXiv:2305.18323 | 2023 | https://arxiv.org/abs/2305.18323 |
| [8] | Zhou et al. | Language Agent Tree Search Unifies Reasoning, Acting, and Planning (LATS) | ICML 2024, arXiv:2310.04406 | 2023 | https://arxiv.org/abs/2310.04406 |
| [9] | Wang, Xie, Jiang et al. | Voyager: An Open-Ended Embodied Agent with LLMs | arXiv:2305.16291 | 2023 | https://arxiv.org/abs/2305.16291 |
| [10] | Kambhampati et al. | LLMs Can't Plan, But Can Help Planning in LLM-Modulo Frameworks | ICML 2024, arXiv:2402.01817 | 2024 | https://proceedings.mlr.press/v235/kambhampati24a.html |
| [11] | Valmeekam, Olmo, Sreedharan, Kambhampati | PlanBench: Evaluating LLMs on Planning and Reasoning about Change | NeurIPS 2023 D&B, arXiv:2206.10498 | 2023 | https://arxiv.org/abs/2206.10498 |
| [12] | Valmeekam, Stechly, Kambhampati | LLMs Still Can't Plan; Can LRMs? Preliminary Evaluation of o1 on PlanBench | arXiv:2409.13373 | 2024 | https://arxiv.org/abs/2409.13373 |
| [13] | Huang, Chen, Shi et al. | Large Language Models Cannot Self-Correct Reasoning Yet | ICLR 2024, arXiv:2310.01798 | 2023 | https://arxiv.org/abs/2310.01798 |
| [14] | Kambhampati | Can Large Language Models Reason and Plan? | Annals of the NYAS, 2024 | 2024 | https://nyaspubs.onlinelibrary.wiley.com/doi/10.1111/nyas.15125 |
| [15] | OpenAI | Learning to Reason with LLMs (o1 system card) | OpenAI blog | 2024 | https://openai.com/index/learning-to-reason-with-llms/ |
| [16] | Weng, Lilian | LLM Powered Autonomous Agents | Lil'Log | 2023 | https://lilianweng.github.io/posts/2023-06-23-agent/ |
| [17] | Bhatia et al. | TheAgentCompany: Benchmarking LLM Agents on Consequential Real World Tasks | arXiv:2412.14161 | 2024 | https://arxiv.org/abs/2412.14161 |
| [18] | Anthropic | Model Context Protocol (MCP) specification | Anthropic docs | 2024 | https://modelcontextprotocol.io |
| [19] | Liu, Iter, Xu et al. | LLMCompiler: An LLM Compiler for Parallel Function Calling | arXiv:2312.04511 | 2023 | https://arxiv.org/abs/2312.04511 |
| [20] | Shen, Song, Tan et al. | HuggingGPT: Solving AI Tasks with ChatGPT and its Friends in HuggingFace | NeurIPS 2023, arXiv:2303.17580 | 2023 | https://arxiv.org/abs/2303.17580 |

---

## 2. CoALA — Cognitive Architectures for Language Agents

### Mechanism

CoALA [1] provides a unifying framework for LLM-based agents along three orthogonal dimensions:

**Memory modules (five types):**
- **Working memory** — active symbolic variables for the current decision cycle; the "scratchpad"
- **Episodic memory** — history event flows, trajectories from previous episodes
- **Semantic memory** — world and self-knowledge from external databases or self-generated inferences
- **Procedural memory (implicit)** — knowledge encoded in LLM weights
- **Procedural memory (explicit)** — code implementing actions and decision procedures (prompt templates, retrieval procedures)

**Action space (four categories):**
- *Retrieval*: read from long-term memory into working memory
- *Reasoning*: process working memory, no long-term storage access
- *Learning*: write to long-term memory (four subtypes: episodic update, semantic update, LLM fine-tuning, code update)
- *Grounding*: interact with physical/digital environments (APIs, web, games)

**Decision-making loop (three sub-stages per cycle):**
1. **Proposal** — generate action candidates via reasoning + optional retrieval
2. **Evaluation** — score each candidate (heuristic, LLM perplexity, learned values)
3. **Selection** — argmax or softmax selection, or rejection and re-proposal

Then **Execution**, followed by environmental observation feeding the next cycle.

### Scope and Purpose

CoALA is a retrospective taxonomic survey, not an empirical contribution. It classifies existing work (ReAct, Reflexion, Voyager, SayCan) and identifies underexplored directions. **[HIGH — stated purpose of paper]**

### Limitations

- Adaptive episodic recall and memory unlearning are identified as understudied
- Updates to procedural memory are labeled "risky for alignment" with no existing implementations at time of writing
- No standardized testbed; the framework lacks a computational model equivalent to Gym-like APIs for RL
- Interaction effects between multiple simultaneous learning types lack systematic study
- Several later architectures (e.g., LATS) do not map cleanly onto CoALA's action space

### Adversarial Notes

CoALA's taxonomy is elegant but has not been empirically validated as the right decomposition. It risks becoming a post-hoc rationalization rather than a predictive theory.

---

## 3. ReAct — Reasoning and Acting

### Mechanism

ReAct [2] (ICLR 2023) interleaves verbal reasoning traces ("thoughts") with executable actions in a unified prompt:
- **Thought**: natural-language reasoning step
- **Action**: concrete tool call (e.g., `Search[query]`, `Finish[answer]`)
- **Observation**: tool's returned result, injected back into context

The loop continues until the agent emits `Finish`. The key claim is that interleaving allows dynamic plan adjustment based on new observations, reducing hallucination vs. reasoning-only chains.

### Quantitative Results

| Benchmark | Task Type | Model | ReAct Score | Baseline | Delta |
|-----------|-----------|-------|-------------|----------|-------|
| HotpotQA | Multi-hop QA | PaLM-540B | ~27.4 EM | CoT: 29.4 EM | −2.0 vs CoT alone |
| HotpotQA | Multi-hop QA | PaLM-540B | ~35.1 EM | CoT-SC: ~33.0 | +2.1 (hybrid) |
| FEVER | Fact verification | PaLM-540B | 60.9% acc | CoT: 56.3% | +4.6% |
| ALFWorld | Text-based game | GPT-3 | +34% abs success | IL/RL baselines | +34% |
| WebShop | Web navigation | — | +10% abs success | IL/RL baselines | +10% |

**[HIGH — from published paper; date-stamp: 2022, PaLM-540B era]**

### Limitations

- On HotpotQA, vanilla ReAct underperforms chain-of-thought alone; the benefit only emerges in hybridization
- Action loop can enter repetitive cycles (same query searched repeatedly)
- Context window fills quickly on tasks requiring many reasoning steps
- ALFWorld/WebShop baselines (IL/RL) are relatively weak — the paper chose baselines that maximize the delta **[MED]**

### Adversarial Notes

The 34% and 10% improvement figures on ALFWorld/WebShop compare against imitation-learning and RL agents, not frontier LLM baselines. The HotpotQA EM score of ~27.4 is *below* CoT alone — a result often omitted in secondary citations. The real contribution on knowledge-intensive QA is the hybrid ReAct+CoT-SC (35.1 EM).

---

## 4. Reflexion — Verbal Reinforcement Learning

### Mechanism

Reflexion [3] (NeurIPS 2023) adds a meta-learning layer atop ReAct-style loops. After each episode ends in failure:
1. **Evaluator** scores the outcome (task-specific heuristic or LLM)
2. **Self-Reflection** module generates a verbal critique of what went wrong
3. Reflection stored in an **episodic memory buffer**
4. On the next trial, the reflection is prepended to context, providing a linguistic "gradient signal"

No weight updates occur — learning is entirely in-context.

### Quantitative Results

| Benchmark | Metric | Reflexion | Baseline | Delta |
|-----------|--------|-----------|----------|-------|
| HumanEval (Python) | Pass@1 | 91% | GPT-4 baseline: 80% | +11% **[HIGH, date: 2023]** |
| ALFWorld | Tasks solved | 130/134 (12 trials) | ReAct: 108/134 | +22 tasks / +16.4% **[HIGH]** |
| HotpotQA | Accuracy | +20% over baseline | ReAct baseline | +20% **[MED — relative, not absolute]** |

### Limitations

- Depends critically on evaluator quality; wrong evaluator → wrong lessons learned
- Performance caps after ~3–5 trials; additional trials yield diminishing returns
- Multiple episode attempts multiply inference cost proportionally
- Episodic memory buffer grows indefinitely; no compression or forgetting mechanism
- Huang et al. [13] directly challenge: intrinsic self-correction without oracle evaluator is unreliable

### Adversarial Notes

The HumanEval 91% is frequently cited but HumanEval has known data leakage issues (GitHub code in training data). The 11% gain over GPT-4 pass@1 is sensitive to temperature and sampling strategy. When the evaluator is itself an LLM, Reflexion's premises collapse per [13].

---

## 5. Self-Refine — Iterative Self-Feedback

### Mechanism

Self-Refine [4] (NeurIPS 2023) uses a single LLM in three roles:
1. **Generator** produces initial output
2. **Feedback provider** critiques the output in natural language
3. **Refiner** edits based on feedback

Loop halts when feedback judges output satisfactory, or after a fixed max iteration count. No training data, external tools, or additional models required.

### Quantitative Results

Evaluated on 7 tasks: code optimization, code readability, math, constrained generation, acronym generation, dialogue generation, sentiment reversal.
- Average absolute improvement: ~20% over one-shot generation **[MED — averaged across diverse tasks]**
- Code generation (Codex): up to +13% absolute **[MED]**
- Claimed 5–40% improvement over GPT-4 on specific tasks **[LOW — upper bound cherry-picked; arithmetic shows minimal gain]**

### Limitations

- Limited effectiveness on mathematical reasoning (GSM8K); binary-correct tasks see little benefit
- Huang et al. [13] demonstrate intrinsic self-correction without oracle feedback is inconsistent
- The "stop when satisfied" criterion is circular: the same model that generated a flawed output judges when it is fixed
- Task selection favors subjective quality (dialogue, style) where any change is plausibly "improvement" **[MED]**

### Adversarial Notes

Self-Refine works best when quality is subjective or the error is obvious (e.g., Python syntax error caught by runtime). The 20% average improvement obscures high variance. Secondary literature has overclaimed this as a general capability, which [13] formally refutes.

---

## 6. Tree of Thoughts and Graph of Thoughts

### Tree of Thoughts (ToT)

**Mechanism [5]** (NeurIPS 2023): Frames problem-solving as tree search over intermediate "thoughts." At each node, the model generates multiple candidate thoughts, evaluates each (LLM-scored heuristic), and applies BFS or DFS. Enables deliberate backtracking — not supported in CoT or ReAct.

**Quantitative Results:**

| Task | GPT-4 + CoT | GPT-4 + ToT | Delta |
|------|-------------|-------------|-------|
| Game of 24 | 4% success | 74% success | +70% **[HIGH]** |
| Mini Crosswords | — | Significant improvement | qualitative |
| Creative Writing | — | Preferred by GPT-4 evaluator | **[LOW — self-evaluated]** |

**Limitations:**
- Requires 5–100x more LLM calls than CoT; slow and expensive
- Tasks are narrow combinatorial puzzles; real-world generalization unproven
- The LLM evaluates its own candidate thoughts — circular when LLM judgment is what's being tested **[MED]**

### Graph of Thoughts (GoT)

**Mechanism [6]** (AAAI 2024, ETH Zurich): Generalizes ToT to arbitrary DAGs, enabling aggregation (merging reasoning branches), refinement, and generation operations. Introduces volume/latency cost model.

**Results:** Claimed best cost/quality tradeoff vs. CoT, ToT, CoT-SC on sorting, set intersection, keyword counting, and document merging tasks **[MED — not widely independently replicated]**

### Adversarial Notes

Both ToT and GoT benchmark tasks were chosen to showcase search advantages (combinatorial, clear success criteria). Neither has demonstrated consistent superiority on long-horizon real-world tasks with unbounded search spaces and noisy evaluation.

---

## 7. Plan-and-Execute / Task Planning with LLMs

### Mechanism

Separates concerns into two phases:
1. **Planner** LLM produces full task decomposition upfront (or iteratively replans)
2. **Executor** (smaller LLM, specialized agent, or deterministic code) executes each subtask independently

**HuggingGPT [20]** (NeurIPS 2023): Uses ChatGPT as a task planner to select and orchestrate HuggingFace models. Pipeline: task planning → model selection → task execution → response summarization. Demonstrates multi-modal multi-model pipelines but is slow and brittle (dependent on model card accuracy).

**LLMCompiler [19]**: Streams a DAG of tasks with explicit dependencies. A Task Fetching Unit schedules and executes tasks once dependencies are met, enabling parallelism. Claimed 3.6x speedup over sequential ReAct. **[MED — speedup depends heavily on task structure]**

### Limitations

- Upfront planning fails when intermediate observations are required to form the next step (dynamic environments)
- Replanning overhead can negate cost savings from parallelism
- LLMCompiler's 3.6x speedup applies to embarrassingly parallel tool-use; sequential-dependency tasks see minimal benefit
- HuggingGPT model selection is fragile: model card descriptions are noisy **[HIGH]**

---

## 8. ReWOO — Decoupled Reasoning

### Mechanism

ReWOO [7] (arXiv:2305.18323) fully decouples the reasoning (planning) phase from the observation phase:
1. **Planner** LLM produces the complete multi-step plan with all tool calls upfront (using `#E[i]` placeholders for future observations)
2. **Worker** executes all tool calls
3. **Solver** synthesizes observations with the original plan to generate the final answer

Tool-call results are not in the reasoning context during planning, eliminating repeated observation tokens.

### Quantitative Results

| Benchmark | ReWOO vs ReAct | Delta |
|-----------|----------------|-------|
| HotpotQA | ~5x token reduction, +4% accuracy | **[HIGH]** |
| Tool failure robustness | Maintains performance | qualitative **[MED]** |

Demonstrates distillation: reasoning can be offloaded from GPT-3.5 (175B) to fine-tuned LLaMA-7B. **[MED]**

### Limitations

- Requires all tool calls to be identifiable without observing intermediate results; fails on tasks requiring dynamic branching
- 5x token efficiency figure is prompt-design-sensitive
- Distilled LLaMA-7B not independently benchmarked on held-out tasks **[LOW]**

### Adversarial Notes

ReWOO solves a real efficiency problem but the accuracy improvement is modest. Assuming a fully-specifiable upfront plan is architecturally similar to classical HTN (Hierarchical Task Networks) planning — a 40-year-old idea, not cited by the authors.

---

## 9. LATS — Language Agent Tree Search

### Mechanism

LATS [8] (ICML 2024) applies Monte Carlo Tree Search (MCTS) to LLM agent trajectories:
- **Selection**: UCT selects which node to expand
- **Expansion**: LLM generates N candidate next actions
- **Evaluation**: LLM-based value function scores each node
- **Simulation**: Roll out candidate trajectories to terminal states
- **Backpropagation**: Update node values with simulation results

Unifies planning (tree search), acting (trajectory execution), and reasoning (LLM as policy and value function).

### Quantitative Results

| Benchmark | LATS + GPT-4 | Best prior | Delta |
|-----------|--------------|------------|-------|
| HumanEval Pass@1 | 92.7–94.4% | GPT-4 vanilla: ~67% | +25–27% **[MED, date: 2023]** |
| HotpotQA | ~2x ReAct | ReAct baseline | +100% relative **[MED]** |
| WebShop avg score | +22.1 over ReAct (GPT-3.5) | ReAct | significant **[MED]** |

### Limitations

- Compute cost scales with tree depth and branching factor; many LLM calls per decision
- The LLM value function is circular: the same model that generates actions evaluates them
- HumanEval 94.4% is post-dating known data contamination concerns
- MCTS assumes well-defined rewards; open-ended task rewards are noisy **[MED]**

### Adversarial Notes

The HumanEval 94.4% is on a saturated benchmark. The paper does not report wall-clock time or cost comparisons, making fair evaluation difficult. LATS essentially converges to "try many trajectories and pick the best one" — powerful but not novel in spirit; the novelty is applying MCTS with LLMs.

---

## 10. Voyager — Open-Ended Skill Acquisition

### Mechanism

Voyager [9] (arXiv:2305.16291) is an LLM-powered agent for open-ended lifelong learning in Minecraft. Three core components:
1. **Automatic curriculum**: GPT-4 proposes exploration goals based on current inventory and world state, always attempting the "frontier" of possible tasks
2. **Skill library**: Executable JavaScript code functions stored in a vector database, retrieved by semantic similarity at planning time
3. **Iterative prompting**: Code is executed in Minecraft, errors + environment feedback are injected back into context, GPT-4 refines the code up to N times per skill

No fine-tuning; interacts with GPT-4 via black-box API queries.

### Quantitative Results

| Metric | Voyager | Prior SOTA (DEPS) | Delta |
|--------|---------|-------------------|-------|
| Unique items obtained | 3.3x more | baseline | +230% **[HIGH]** |
| Distance traveled | 2.3x longer | baseline | +130% **[HIGH]** |
| Tech tree milestones | up to 15.3x faster | baseline | large **[HIGH]** |
| New-world generalization | Succeeds on novel tasks | Other methods fail | qualitative **[MED]** |

### Limitations

- Minecraft is a controlled, deterministic environment with a clear tech-tree metric; generalization to unstructured real-world tasks undemonstrated
- Skill library built on JavaScript code within Minecraft's API; not applicable as-is to other domains
- GPT-4 API costs were substantial for extended runs; not reported
- Prior SOTA (DEPS) was relatively weak; comparison with a strong GPT-4 ReAct baseline would be more informative **[MED]**

### Adversarial Notes

Voyager's impact is partially a function of Minecraft's unique properties: clear tasks, executable feedback, a tech tree rewarding exploration monotonically. The generalization claims assume the new world has the same environmental affordances as training — not truly zero-shot. The "skill library as retrieval-augmented procedural memory" idea is genuinely novel and has been widely adopted.

---

## 11. The "Can LLMs Plan?" Debate

### Kambhampati's Position: LLMs Cannot Plan

Kambhampati and colleagues [10, 11, 12, 14] have sustained the most systematic empirical challenge to LLM planning claims.

**Core argument [10, 14]:**
- Auto-regressive LLMs are approximate next-token predictors; planning requires search over a state space with correctness guarantees — a fundamentally different computation
- Apparent planning ability stems from "exemplar-query similarity" (test problem resembles something in training data), not generative search
- LLMs cannot self-verify plans; self-correction loops do not produce sound outputs without external validators

**PlanBench results [11]:**
- 600 Blocksworld instances, GPT-4: **34.6% zero-shot success rate** (~65% failure) **[HIGH, date: 2023]**
- Performance degrades severely under "surface obfuscation" (renaming objects), suggesting pattern-matching not planning

**o1 on PlanBench [12]:**
- o1 shows "quantum improvement, outpacing the competition" but "still far from saturating" PlanBench **[MED, date: Sept 2024]**
- Authors conclude: even Large Reasoning Models cannot reliably plan; deployment raises unresolved accuracy, efficiency, and guarantee questions

**LLM-Modulo Framework [10]:**
Rather than replacing planners with LLMs, proposes using LLMs as:
- Idea generators (propose candidate plans or partial plans)
- Problem translators (convert natural language to formal representations)
- Reformulators (help domain modelers define PDDL)

Correctness guaranteed by **external model-based verifiers** (classical planners, symbolic validators), not the LLM itself.

### Counter-Positions: Reasoning Models Change the Picture

**o1/o3 benchmark performance [15] (date: Dec 2024):**
- o3: 91.6% on AIME 2024 (vs o1: 74.3%) **[HIGH]**
- o3: 83.3% on GPQA Diamond (PhD-level science) **[HIGH]**
- o3: 3x ARC-AGI accuracy vs o1 **[HIGH]**
- Cost: o1 is ~6x more expensive and ~30x slower than GPT-4o; o3 is more expensive still

**What changed:** Extended compute-at-inference-time improves performance on multi-step deduction tasks.

**What did not change:**
- Formal guarantees of plan soundness remain absent
- LRMs still fail on novel problem structures not in training distribution
- Compute cost per planning query makes them impractical for real-time applications **[MED]**

### The Huang et al. Challenge

Huang et al. [13] (ICLR 2024): when LLMs self-correct without access to oracle labels, performance does not reliably improve and sometimes degrades. This directly challenges Reflexion and Self-Refine when the evaluator is another (or the same) LLM.

**Conclusion: self-improvement without external feedback is not a reliable capability as of 2023–2024** **[HIGH]**

---

## 12. The Perceive-Plan-Act-Observe Loop as Governance Structure

### Canonical Loop

```
PERCEIVE → REASON → PLAN → ACT → OBSERVE → [repeat or TERMINATE]
```

| Stage | What happens | CoALA equivalent |
|-------|-------------|-----------------|
| Perceive | Convert environment inputs to working memory | External grounding + working memory write |
| Reason | LLM processes working memory to generate new information | Reasoning action |
| Plan | Decompose goal into actions; propose, evaluate, select | Proposal + evaluation + selection |
| Act | Execute selected action (tool call, code, message) | Execution stage |
| Observe | Receive result; update working memory | Working memory update + optional episodic write |

### Variants by Architecture

| Framework | How it modifies the base loop |
|-----------|-------------------------------|
| ReAct | Collapses Reason+Plan+Act into a single interleaved token stream |
| ReWOO | Separates Plan phase fully upfront; Observe feeds only the Solve phase |
| Reflexion | Adds post-episode meta-loop: Observe → Self-Reflect → Update episodic memory |
| ToT/LATS | Replaces linear Act with tree-search over action candidates |
| Voyager | Adds persistent Skill Library; Plan queries it; Act updates it |
| Plan-and-Execute | Splits into two nested loops: outer planner + inner executor |

### Governance Implications

The loop structure determines where safety and control can be enforced:
- **Pre-Plan hooks**: validate the plan before execution (LLM-Modulo verifiers operate here)
- **Pre-Act hooks**: check each action before it fires (e.g., "do not call DELETE endpoints")
- **Post-Observe hooks**: sanitize or filter observations before they enter context
- **Termination conditions**: evaluate after each full loop iteration whether to continue

---

## 13. Harness-Level Governance

### What is a Harness?

The harness is the infrastructure envelope around the agent loop — the orchestration layer that initializes the agent, manages the loop, provides tools, and enforces operational policies. The LLM itself is one component; the harness governs the system. **[HIGH — industry consensus as of 2025–2026]**

### Core Governance Controls (Production Patterns)

**1. Step cap (iteration limit)**
- Hard ceiling on the number of Perceive-Plan-Act-Observe cycles
- Prevents runaway loops from tool failures or ambiguous stopping conditions
- Typical values: 10–50 steps for single-agent tasks; 100+ for multi-agent workflows
- Failure mode without cap: infinite loop consuming tokens and incurring unbounded cost

**2. Recursion depth limit**
- Critical in multi-agent architectures (agent-calling-agent)
- Without a depth limit, a planner spawning subagents that each spawn subagents creates exponential fan-out
- MCP [18] standardized tool/agent connectivity but does not natively enforce recursion limits — harness responsibility

**3. Timeouts**
- Per-tool-call timeout: prevents single hanging API call from stalling the entire agent
- Per-episode timeout: wall-clock budget for the full task
- Failure mode: agent successfully calls a tool and waits indefinitely for a response that never arrives

**4. Cost ceiling (token budget)**
- Total token spend (input + output) monitored per session
- When budget is exhausted, harness terminates gracefully and returns structured failure message
- TheAgentCompany [17] reports top agents spending ~$4.20 per task at only 30.3% success — cost governance is critical at scale **[HIGH, date: Dec 2024]**

**5. Repeat-call detection**
- Identifies when the same action (or near-identical action) fires repeatedly
- Signals the agent is stuck in a semantic loop
- Implemented as hash-based deduplication check on recent actions

**6. Action allowlists / blocklists**
- Pre-Act governance: whitelist approved tool calls, blocklist destructive operations (DELETE, irreversible writes, external sends)
- Critical for agentic systems with real-world side effects

### Failure Modes Without Governance

| Missing control | Failure mode | Example |
|-----------------|--------------|---------|
| No step cap | Infinite token burn | Agent searches same query 50+ times |
| No timeout | Hung pipeline | Tool API returns 504; agent waits forever |
| No cost ceiling | Unbounded cost | Multi-agent spawning cascade in LATS-style search |
| No repeat-call detection | Semantic loop | ReAct agent cycles through same 3 actions |
| No action blocklist | Unintended side effects | Agent calls DELETE on production database |
| No depth limit (multi-agent) | Exponential fan-out | Planner → 5 subagents → each spawn 5 more |

### MCP and Its Governance Gap

MCP [18] (Anthropic, 2024) solved *connectivity* — agents can reach tools through a common interface. It did not solve:
- Cross-agent coordination
- Access control and permission scoping
- Rate limiting at the tool level
- Sandboxed execution

These remain harness-level responsibilities. **[HIGH, date: 2025–2026]**

---

## 14. Key Tensions and Open Questions

### T1: Self-Improvement vs. Oracle Dependency

Reflexion, Self-Refine, and LATS assume agents can self-evaluate and self-improve. Huang et al. [13] demonstrate that intrinsic self-correction without external oracles is unreliable. Most paper experiments provide ground-truth feedback via the benchmark environment — an oracle. In real deployment, such oracles rarely exist.

**Open question:** Can agents develop reliable self-evaluation without ground-truth supervision?

### T2: Benchmark Saturation and Gaming

| Claim | What the paper shows | Gap |
|-------|---------------------|-----|
| Self-Refine: "5–40% improvement over GPT-4" | Subjective tasks only | Cherry-picked upper bound |
| Reflexion: "91% pass@1" | HumanEval (likely contaminated) | Benchmark contamination |
| ReAct: "+34% on ALFWorld" | vs. IL/RL baselines | Weak baseline chosen |
| Voyager: "15.3x faster tech tree" | vs. DEPS (weak baseline) | Comparison bias |
| LATS: "SOTA HumanEval" | Saturated benchmark | Saturated benchmark |

TheAgentCompany [17] (30.3% success on realistic workplace tasks, date: Dec 2024) is a step toward uncontaminated real-world evaluation.

### T3: Token Efficiency vs. Capability

Architectures that improve reasoning quality (ToT, LATS, o3) dramatically increase token consumption (10–100x). ReWOO reduces tokens but limits dynamic planning. No architecture simultaneously achieves high accuracy, token efficiency, and low latency.

### T4: Planning Soundness vs. Linguistic Flexibility

Classical planners provide soundness guarantees but require expensive formal domain models. LLMs provide flexibility but cannot guarantee plan validity. LLM-Modulo [10] proposes a hybrid but pushes the domain modeling problem to a new level of difficulty.

### T5: Memory Without Forgetting

All frameworks with persistent memory (Reflexion episodic buffers, Voyager skill libraries) accumulate content indefinitely. No principled mechanism for unlearning incorrect memories, resolving conflicts, or compressing episodic history. CoALA [1] explicitly flags memory deletion as "understudied."

### T6: Harness Governance Is Not Principled

Rate limits, sandboxing, and depth caps are pragmatic but not principled. Formal models of multi-agent control (akin to session types or process calculi) remain unexplored in this literature. MCP standardizes connectivity, not governance.

---

*Review synthesized June 2026. All confidence tags are author's assessment based on evidence strength, replication status, and adversarial scrutiny.*
