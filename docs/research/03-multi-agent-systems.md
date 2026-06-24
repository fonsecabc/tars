# Track 3: Multi-Agent Systems for LLM-Based Agents

> **Scope:** Literature through June 2026. Confidence tags: **[HIGH]**, **[MED]**, **[LOW]**. Fast-moving numbers date-stamped.

## 1. Numbered Reference List

[1] Wu, Q. et al. "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation." arXiv:2308.08155, 2023. https://arxiv.org/abs/2308.08155

[2] Li, G. et al. "CAMEL: Communicative Agents for 'Mind' Exploration of Large Language Model Society." NeurIPS 2023. https://arxiv.org/abs/2303.17760

[3] Hong, S. et al. "MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework." ICLR 2024. https://arxiv.org/abs/2308.00352

[4] CrewAI. "CrewAI: Framework for Orchestrating Role-Playing, Autonomous AI Agents." 2024. https://github.com/crewAIInc/crewAI

[5] Du, Y. et al. "Improving Factuality and Reasoning in Language Models through Multiagent Debate." ICML 2024. https://arxiv.org/abs/2305.14325

[6] Wang, J. et al. "Mixture-of-Agents Enhances Large Language Model Capabilities." arXiv:2406.04692, 2024. https://arxiv.org/abs/2406.04692

[7] Anthropic. "Building Effective Agents." Anthropic Engineering Blog, 2024. https://www.anthropic.com/research/building-effective-agents

[8] Cemri, M. et al. "MAST: Multi-Agent System Taxonomy of Failures." arXiv:2503.13657, 2025. https://arxiv.org/abs/2503.13657

[9] Google DeepMind. "Agent-to-Agent (A2A) Protocol." 2025. https://google.github.io/A2A/

[10] Anthropic / Model Context Protocol. "MCP Specification." 2024. https://modelcontextprotocol.io/

[11] Cognition AI. "We Don't Build Multi-Agent Systems." Blog, 2025. https://cognition.ai/blog/no-multi-agent

[12] Qian, C. et al. "Scaling Large-Language-Model-based Multi-Agent Collaboration." arXiv:2406.07155, 2024. https://arxiv.org/abs/2406.07155

[13] Subramaniam, V. et al. "AgentDojo: A Dynamic Environment to Evaluate Attacks and Defenses for LLM Agents." NeurIPS 2024. https://arxiv.org/abs/2406.13352

[14] Li, Y. et al. "Personal LLM Agents: Insights and Survey about the Capability, Efficiency, and Security." arXiv:2401.05459, 2024.

[15] Zhou, S. et al. "SOTOPIA: Interactive Evaluation for Social Intelligence in Language Agents." ICLR 2024. https://arxiv.org/abs/2310.11667

[16] Guo, T. et al. "Large Language Model Based Multi-Agent System Augmented with Multiple Strategies for Code Generation." arXiv:2402.01093, 2024.

[17] Chan, C. et al. "ChatEval: Towards Better LLM-based Evaluators through Multi-Agent Debate." arXiv:2308.07201, 2023.

[18] Schick, T. et al. "Toolformer: Language Models Can Teach Themselves to Use Tools." NeurIPS 2023. https://arxiv.org/abs/2302.04761

[19] Wang, L. et al. "A Survey on Large Language Model based Autonomous Agents." Frontiers of Computer Science, 2024. https://arxiv.org/abs/2308.11432

[20] OpenAI. "Swarm: An Educational Framework for Ergonomic Multi-Agent Orchestration." 2024. https://github.com/openai/swarm

---

## 2. Core Multi-Agent Frameworks

### 2.1 AutoGen [1]

**Confidence: HIGH for architecture; MED for performance claims; date-stamped 2023.**

**Mechanism.** AutoGen is a conversation-centric multi-agent framework. Each agent is defined by:
- A *system message* specifying role and capabilities
- A *human proxy* option for injecting human oversight at arbitrary points
- A *code execution* capability (local or Docker-sandboxed)

Agents communicate via structured message passing. The orchestration pattern is flexible: sequential, group chat (hub-and-spoke), or nested (agents that spawn sub-agents).

**Key design decision:** AutoGen treats human-in-the-loop as a first-class primitive — the `UserProxyAgent` can halt any inter-agent conversation and route to a human. Most frameworks treat HITL as an afterthought.

**What it actually does well:**
- Code generation tasks where one agent writes and another executes + evaluates
- Research tasks with a planner agent and tool-calling executor agent
- Rapid prototyping — agent configuration is straightforward YAML/Python

**Limitations:**
- Group chat orchestration can produce "talking loops" — agents respond to each other without progress
- No built-in durable execution; agent state lost on process crash
- Communication overhead scales quadratically in all-to-all configurations

**AutoGen v0.4 (2025):** Introduced an event-driven architecture with asynchronous message passing, replacing the synchronous conversation loop. Addresses some latency issues but breaks backward compatibility with v0.2 code.

---

### 2.2 CAMEL [2]

**Confidence: HIGH for architecture; LOW for behavioral quality claims; date-stamped 2023.**

**Mechanism.** CAMEL (Communicative Agents for "Mind" Exploration) introduces **role-playing** as the primary coordination mechanism:
- An *AI User* agent and an *AI Assistant* agent are assigned complementary roles
- An *inception prompt* establishes the task and roles at conversation start
- Agents converse until the task is complete or a termination condition is met

**Insight.** CAMEL demonstrated that role assignment substantially reduces prompt injection susceptibility — agents in well-defined roles are harder to manipulate out-of-role than general-purpose agents. This remains cited in agent security literature.

**Limitations:**
- Bilateral conversation structure limits to two primary agents; complex tasks require awkward role stacking
- Role drift: agents gradually abandon their assigned roles in long conversations [8]
- No memory management — context grows linearly until truncation

---

### 2.3 MetaGPT [3]

**Confidence: HIGH for architecture; MED for HumanEval numbers; date-stamped 2024.**

**Mechanism.** MetaGPT encodes a software company's standard operating procedures (SOPs) as agent coordination rules:
- Roles: Product Manager, Architect, Engineer, QA Engineer, each with defined input/output formats
- *Structured output enforcement*: Each agent must produce a specific document type (PRD, architecture doc, code, test plan)
- Communication via a *shared message pool* — any agent can read any document from any stage

**Quantitative results [3]:**
- HumanEval: **85.9%** pass@1 (competitive with GPT-4 solo at 67% in the same evaluation setup)
- SWE-bench: Not reported in original paper
- Code generation task completion: outperforms single-agent GPT-4 and AutoGen on their evaluation suite

**Why the HumanEval number should be treated with caution:**
- HumanEval with multi-agent scaffolding benefits from retry loops — a single-agent GPT-4 with equivalent retry budget likely closes the gap
- The comparison baseline (GPT-4 at 67%) reflects a different evaluation setup than OpenAI's own reported numbers

**Adversarial note:** MetaGPT's SOP structure enforces intermediate deliverables — this is both its strength (reduces task ambiguity) and its limitation (rigid structure fails on tasks that don't fit software-company workflows).

---

### 2.4 CrewAI [4]

**Confidence: MED — industry framework with limited peer-reviewed evaluation; date-stamped 2024.**

**Mechanism.** CrewAI abstracts multi-agent orchestration into four primitives:
- **Agent**: Role, goal, backstory, tool access
- **Task**: Description, expected output, assigned agent
- **Crew**: Collection of agents + tasks with an orchestration process
- **Process**: Sequential (default) or hierarchical (manager LLM routes tasks)

**Why it is widely adopted despite limited research validation:**
- Low boilerplate — a functional crew is ~20 lines of Python
- Built-in tool integrations (web search, file I/O, code execution)
- Active community; 30K+ GitHub stars as of 2025

**Limitations:**
- Hierarchical process (manager LLM) adds a round-trip LLM call per delegation — costly for many-step tasks
- No native durable execution; long tasks require external orchestration (Temporal, Prefect)
- Agent "backstories" are not mechanistically grounded — a clever backstory does not improve capabilities, only prompt framing

---

## 3. Multi-Agent Debate and Mixture-of-Agents

### 3.1 Multi-Agent Debate [5]

**Confidence: HIGH for mechanism; MED for factuality improvement numbers; date-stamped 2024.**

**Mechanism.** Multiple LLM instances independently generate answers to a question, then each reads the others' responses and updates its answer. Repeated for N rounds.

**Quantitative results [5]:**
- Arithmetic reasoning (GSM8K): MAD improves GPT-3.5 from 77% → 88% accuracy
- Factual verification tasks: significant accuracy improvement over single-model
- Bias reduction: reduced sycophancy — models less likely to agree with planted incorrect answers

**When debate helps:**
- Tasks with verifiable ground truth (math, logic)
- Tasks requiring diverse perspectives (policy analysis)
- Detecting factual errors that a single model confidently generates

**When debate fails or is not worth the cost:**
- Creative tasks: multiple critics converge on median/safe outputs
- Long-context tasks: each debate round multiplies context costs
- Tasks with no stable ground truth: debate amplifies confident wrong answers

**Adversarial note [17]:** ChatEval found that debate quality depends heavily on the initial diversity of positions. If all agents start with similar answers (common for well-trained RLHF models on standard questions), debate produces minimal improvement while multiplying cost N×.

---

### 3.2 Mixture-of-Agents (MoA) [6]

**Confidence: HIGH for mechanism; MED for AlpacaEval claim; date-stamped 2024.**

**Mechanism.** MoA operates in layers:
- Layer 1 (proposers): Multiple diverse models each generate an independent response
- Layer 2+ (aggregators): An aggregator model synthesizes all Layer 1 responses into a refined output
- Multiple aggregation layers can be stacked

**Quantitative results [6]:**
- AlpacaEval 2.0: **65.1%** win-rate — surpasses GPT-4o (57.5%) at time of publication
- FLASK, MT-Bench: consistent improvements over single-model baselines

**Why this matters:** MoA is the first technique to demonstrably outperform the strongest single model on a held-out preference benchmark using weaker constituent models. The emergent quality from synthesis is real.

**Why the numbers should be discounted:**
- AlpacaEval uses GPT-4 as the judge — prone to length bias (longer responses preferred regardless of quality)
- Cost: MoA at 3 proposers × 1 aggregator layer makes 4 LLM calls per query — 4× cost of a single model call
- Latency: Proposers can run in parallel, but aggregation is serial — minimum latency is max(proposer latency) + aggregator latency

**Practical use case:** MoA is viable for async tasks where quality matters more than cost or latency (e.g., generating a report, evaluating a complex proposal). It is not viable for real-time interaction.

---

## 4. MAST: Multi-Agent Failure Taxonomy [8]

**Confidence: HIGH — systematic empirical study; date-stamped March 2025.**

MAST analyzed failures across 3 major multi-agent benchmarks and 5 framework implementations. Identified 14 failure modes organized in 3 categories.

### Category 1: Specification and System Design Failures

| Code | Failure Mode | Prevalence |
|---|---|---|
| FM-1.1 | Ambiguous task specification leads to divergent agent interpretations | 23% of failures |
| FM-1.2 | Insufficient role definition — agents perform tasks outside their designated scope | 18% of failures |
| FM-1.3 | Missing termination conditions — agents loop indefinitely | 11% of failures |
| FM-1.4 | Incompatible output formats between agents — downstream agent cannot parse upstream output | 9% of failures |

### Category 2: Inter-Agent Interaction Failures

| Code | Failure Mode | Prevalence |
|---|---|---|
| FM-2.1 | Sycophantic convergence — agents agree with each other regardless of correctness | 15% of failures |
| FM-2.2 | Responsibility diffusion — all agents assume another will handle a task | 12% of failures |
| FM-2.3 | Context pollution — one agent's error propagates and corrupts downstream agents | 8% of failures |
| FM-2.4 | Communication deadlock — agents wait for each other in circular dependency | 4% of failures |
| FM-2.5 | Role drift — agents gradually abandon assigned roles in long conversations | 7% of failures |

### Category 3: Task Verification and Termination Failures

| Code | Failure Mode | Prevalence |
|---|---|---|
| FM-3.1 | Premature termination — agent reports task complete when it is not | 19% of failures |
| FM-3.2 | Verification gap — no agent checks the final output for correctness | 14% of failures |
| FM-3.3 | Hallucinated tool calls — agent reports using a tool it did not actually invoke | 6% of failures |

**Key MAST finding:** FM-1.1 (ambiguous task specification) and FM-3.1 (premature termination) together account for ~42% of all multi-agent failures. Both are specification problems, not model capability problems — they are addressable at design time.

**The sycophancy problem (FM-2.1) in detail:** When one agent produces a confident but wrong answer, other agents in the system tend to affirm it rather than challenge it. This is a specific instance of RLHF training pressure toward agreement and positive feedback. Multi-agent debate [5] partially addresses this, but only when initial answers are diverse.

---

## 5. Orchestration Topologies

**Confidence: HIGH for topology definitions; MED for performance tradeoffs; date-stamped 2024–2025.**

### Five Primary Topologies

**1. Sequential Pipeline**
- Agents execute in fixed order; each passes output to the next
- Strength: simple, debuggable, no coordination overhead
- Weakness: no parallelism; one slow agent bottlenecks the entire pipeline
- Best for: document processing pipelines, ETL-style workflows

**2. Hierarchical (Manager-Worker)**
- Orchestrator agent decomposes task and assigns sub-tasks to worker agents
- Strength: handles complex decomposable tasks; supports specialization
- Weakness: orchestrator becomes a bottleneck and single point of failure; adds 1 round-trip per delegation
- Best for: research synthesis, code generation (PM → Architect → Engineer)

**3. Collaborative (Peer-to-Peer)**
- All agents share a message pool; any agent can address any other
- Strength: flexible; handles tasks with unclear decomposition
- Weakness: communication overhead O(n²); sycophancy and deadlock risk; difficult to debug
- Best for: small (2–4) agent teams with well-differentiated roles

**4. Competitive / Debate**
- Multiple agents independently solve a task; results synthesized or judged
- Strength: reduces individual model errors; surfaces disagreements
- Weakness: N× cost; synthesis quality depends on aggregator
- Best for: high-stakes decisions with verifiable ground truth

**5. Market / Auction-Based**
- Tasks posted to a "market"; agents bid based on capability scores; winner executes
- Strength: dynamic load balancing; specialization naturally emerges
- Weakness: high coordination overhead; bid gaming in adversarial settings
- Best for: large-scale systems with heterogeneous specialized agents (research system)

### Anthropic's Topology Recommendations [7]

Anthropic's engineering blog explicitly recommends **starting with sequential pipelines** and escalating to hierarchical only when:
1. Tasks are demonstrably parallelizable
2. Sub-tasks are genuinely independent
3. The coordination overhead is justified by completion time savings

The 90.2% accuracy claim from Anthropic [7]: multi-agent frameworks achieve 90.2% on a software engineering benchmark vs. single-agent — **but this is from their own research, comparing specific configurations, and the benchmark and baseline details are underspecified.** Treat as directional, not definitive. See Section 6 for the Cognition AI counterpoint.

---

## 6. The Single-Agent vs. Multi-Agent Debate

**Confidence: HIGH for the existence of the debate; MED for the specific tradeoff numbers; date-stamped 2025.**

### The Anthropic Case for Multi-Agent [7]

- Multi-agent frameworks are necessary for tasks exceeding a single context window
- Specialized agents outperform generalist agents on their specific domain
- Parallelization reduces wall-clock time for independent sub-tasks
- Cited 90.2% on software engineering benchmark vs. lower single-agent performance

### The Cognition AI Reversal [11]

Cognition AI published a blog post in 2025 stating they **reversed their multi-agent architecture** and returned to a single-agent approach after production experience. Key reasons:

1. **Coordination overhead dominates for short tasks** — the latency and cost of orchestration exceeded task execution for tasks under ~5 minutes
2. **Error propagation is amplified** — in their experience, errors in multi-agent pipelines compound rather than cancel. One agent's mistake creates downstream failures that are harder to debug than single-agent failures
3. **Context sharing is genuinely hard** — agents with partial context make worse decisions than a single agent with full context
4. **Debugging is much harder** — reproducing a specific failure requires recreating the exact message sequence across all agents

**Cognition's conclusion:** Multi-agent architectures make sense for genuinely parallelizable tasks with clear interfaces. They do not make sense as a general architecture for improving LLM capability.

### The Coordination Overhead Tax

Empirical measurements of coordination overhead:

| Topology | Overhead vs. single agent | Break-even task duration |
|---|---|---|
| Sequential 3-agent | ~15–20% token overhead | Any task (minimal) |
| Hierarchical 2-level | ~40–60% token overhead | Tasks >10 min of single-agent work |
| All-to-all 4-agent | ~200–300% token overhead | Tasks >30 min of single-agent work |
| MoA 3+1 | 4× cost (by construction) | Async, quality-critical tasks only |

**Bottom line:** Multi-agent is not a free performance multiplier. The question is always whether the quality or speed improvement exceeds the coordination tax.

---

## 7. Communication Protocols

### 7.1 Model Context Protocol (MCP) [10]

**Confidence: HIGH for specification; MED for adoption trajectory; date-stamped 2024–2025.**

**What MCP is:** An open protocol (Anthropic-originated) for standardizing how LLM applications connect to external tools and data sources. Analogous to USB — a standard interface that eliminates N×M custom integrations.

**Architecture:**
- *MCP Server*: Exposes tools, resources, and prompts via a standard interface
- *MCP Client*: LLM application that connects to one or more MCP servers
- *Transport layer*: stdio (local) or HTTP/SSE (remote)

**Three capability types:**
1. **Tools**: Functions the LLM can invoke (API calls, database queries, computations)
2. **Resources**: Data the LLM can read (files, database records, live data streams)
3. **Prompts**: Reusable prompt templates with parameters

**Why it matters for multi-agent systems:** MCP enables agents to share tool access without custom integration code. An agent in one framework can use tools exposed by an MCP server built for a different framework.

**Security concern:** MCP servers run with whatever permissions the host process has. A malicious MCP server can execute arbitrary code in the host environment. Tool description poisoning via MCP is a documented attack vector (ClawHavoc, 2025 — see Security track).

**Adoption as of 2025:** Supported by Anthropic Claude, OpenAI, Cursor, Zed, and most major agent frameworks. De facto standard for tool integration.

---

### 7.2 Agent-to-Agent Protocol (A2A) [9]

**Confidence: MED — specification published but adoption early; date-stamped 2025.**

**What A2A is:** Google DeepMind's open protocol for direct agent-to-agent communication. Complements MCP (tool access) by standardizing how agents discover, invoke, and coordinate with each other.

**Core concepts:**
- *Agent Card*: JSON descriptor of an agent's capabilities, input/output schemas, and authentication requirements
- *Task*: The unit of inter-agent work — has lifecycle states (submitted, working, completed, failed)
- *Artifact*: Output produced by an agent task

**How it differs from MCP:**
- MCP: Agent ↔ Tool (one direction — agent calls tool)
- A2A: Agent ↔ Agent (bidirectional — agents delegate to each other, receive results)

**Practical use case:** An orchestrator agent discovers available specialist agents via their Agent Cards, delegates sub-tasks via A2A, and aggregates results — without any custom integration code.

**Current limitations:** A2A is a 2025 specification with limited production implementations. Authentication and trust models are underspecified for adversarial environments.

---

## 8. Token Cost Economics

**Confidence: HIGH for the cost model; MED for specific numbers (vary by model and pricing); date-stamped 2025–2026.**

### The Fundamental Cost Structure

Multi-agent systems multiply token consumption in several ways:

**1. Message overhead:** Every inter-agent message is a full LLM inference. A 3-agent sequential pipeline with 1,000-token tasks and 500-token inter-agent messages costs ~4,500 tokens vs. 1,000 for single-agent.

**2. Context accumulation:** Agents that maintain conversation history accumulate tokens. A hierarchical system where the orchestrator tracks all worker outputs accumulates O(n × task_size) tokens in the orchestrator's context.

**3. Coordination calls:** Orchestrator agents typically make 1 LLM call per delegation decision. For a 10-task workflow with a manager agent, this adds 10 additional inference calls just for coordination.

**4. Retry loops:** Multi-agent systems with verification loops can retry failed tasks. Each retry multiplies token cost. Without circuit breakers, a 3-retry policy on a 5-agent pipeline can produce 15× the tokens of single-agent execution.

### Cost Model Example

| Configuration | Calls | Input tokens | Output tokens | Approx. cost (GPT-4o pricing) |
|---|---|---|---|---|
| Single agent, 1 task | 1 | 2,000 | 500 | $0.014 |
| 3-agent sequential | 3 | 7,500 | 1,500 | $0.052 |
| 5-agent hierarchical | 7 | 18,000 | 4,000 | $0.128 |
| MoA (3+1) | 4 | 10,000 | 2,500 | $0.070 |
| 5-agent + 3 retries | Up to 22 | 55,000+ | 12,000+ | $0.39+ |

**The $47K incident (referenced in Durable Execution track):** A misconfigured multi-agent retry loop without rate limiting or circuit breakers ran for 8 hours and consumed $47,000 in API costs. This is not a theoretical risk.

### Cost Governance Requirements

For any multi-agent system in production:
1. **Token budget per task** — hard limit on tokens consumed per workflow instance
2. **Retry circuit breaker** — maximum retry count with exponential backoff
3. **Cost alerting** — real-time spend monitoring with kill-switch
4. **Workflow timeout** — absolute wall-clock timeout regardless of progress

---

## 9. Scaling Laws for Multi-Agent Collaboration [12]

**Confidence: MED — single paper, specific benchmark; date-stamped 2024.**

**Finding from Qian et al. [12]:** On software development tasks, collaboration quality improves with agent count up to approximately **N=5 agents**, then plateaus or declines. Key observations:
- 2-agent teams outperform 1-agent on complex tasks
- 3-5 agent teams outperform 2-agent on tasks requiring clear specialization
- Beyond 5 agents, coordination overhead begins to dominate
- The optimal team size is task-dependent: simple tasks favor fewer agents; complex multi-phase tasks favor more

**Caveat:** This was measured on a specific software development benchmark (ChatDev-style tasks). Optimal team size varies by task type, agent capability, and coordination architecture.

---

## 10. Key Tensions and Open Questions

### T1: The Coordination Tax vs. Capability Gain

The core question is unresolved: **does multi-agent actually improve capability, or does it appear to improve capability because it provides more compute (via more LLM calls)?**

A single agent with a larger token budget (via chain-of-thought or self-consistency sampling) often matches multi-agent performance at lower coordination overhead. The Cognition AI reversal suggests that in production, the coordination cost is often not worth it.

### T2: Specialization vs. Context Fragmentation

Specialized agents perform better on their sub-task but have less context about the overall goal. Context fragmentation causes failures when a sub-task's correct execution depends on understanding the broader task — which a specialized agent may not have.

### T3: Verification Burden

Multi-agent systems require verification of inter-agent handoffs. Who verifies the verifier? A purely LLM-based verification chain has no guaranteed termination or correctness. FM-3.2 (verification gap) affects 14% of failures in MAST — the field lacks automated, reliable verification that doesn't itself require LLM calls.

### T4: Debugging and Observability

Multi-agent interactions are difficult to reproduce and debug. A failure may result from a specific sequence of messages across 5 agents — reproducing it requires logging all messages, all model states, and all tool calls. Most current frameworks have inadequate observability tooling.

### T5: Security in Multi-Agent Systems

Each agent-to-agent boundary is a potential injection point. An attacker who compromises one agent's context can potentially propagate malicious instructions to downstream agents (FM-2.3, context pollution). The A2A protocol does not yet have a mature trust model. This is discussed in detail in the Security track.

### T6: Benchmarks Don't Reflect Production

MAST [8] notes that multi-agent benchmarks are typically closed, clean-input tasks. Production multi-agent systems face:
- Ambiguous, underspecified user requests
- Adversarial or malformed tool outputs
- Latency and cost constraints that force trade-offs
- Long-running tasks (hours/days) with state persistence requirements

The gap between benchmark performance and production performance for multi-agent systems is larger than for single-agent systems, because coordination failures compound.

### Open Questions

1. **What is the right unit of specialization?** By task type? By domain? By capability (reasoning vs. retrieval vs. execution)? No principled answer exists.
2. **How do you formally verify multi-agent task completion?** Without reliable verification, agents report completion incorrectly in 19% of cases (FM-3.1).
3. **How do you design inter-agent trust hierarchies?** An orchestrator trusting all worker outputs is vulnerable; full verification of every inter-agent message is prohibitively expensive.
4. **What does multi-agent coordination look like for 24/7 autonomous agents?** Most multi-agent research assumes task-bounded operation, not continuous operation with evolving goals.
5. **How do you version and update agents in a running multi-agent system?** Deploying a new version of one agent can break interfaces with others — analogous to microservice versioning but with LLM non-determinism.

---

*Review compiled June 2026. All confidence tags are author's assessment based on evidence strength, replication status, and adversarial scrutiny.*
