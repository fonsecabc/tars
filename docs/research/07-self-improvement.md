# Track 7: Self-Improvement & Continual Learning

> **Scope:** Literature through June 2026. Confidence tags: **[HIGH]**, **[MED]**, **[LOW]**. The hype is extreme — deflating with evidence.

---

## 7.0 Executive Summary

"Self-improving AI" is one of the most hyped concepts in the field. The actual evidence is considerably more constrained. This chapter distinguishes three quite different phenomena that are often conflated:

1. **Prompt and skill optimization without weight updates** — systems that improve their behavior through better instructions, few-shot examples, and stored skill libraries, with model weights unchanged. This works, has quantitative support, and is deployable today.

2. **Continual fine-tuning with weight updates** — systems that update model weights in response to new data or experience. This faces fundamental obstacles (catastrophic forgetting, cost, data requirements) that make it impractical for per-interaction use and difficult even for periodic batch updates.

3. **Autonomous recursive self-improvement** — systems that improve their own training or architecture without human involvement. This is largely theoretical, unsupported by reproducible evidence, and introduces severe safety risks.

The practical roadmap for a personal agent is heavily skewed toward (1), cautiously toward (2) in batch settings, and away from (3) entirely.

---

## 7.1 Skill and Prompt Optimization (No Weight Updates)

These approaches improve agent behavior without modifying model weights. They are the most mature and deployable methods.

### 7.1.1 Voyager (Wang et al., 2023) — Minecraft Skill Library

**Citation:** Wang, G., et al. (2023). Voyager: An Open-Ended Embodied Agent with Large Language Models. arXiv:2305.16291.

**Architecture:**
- Automatic curriculum generator: proposes tasks of increasing difficulty based on current inventory and world state
- Skill library: executable JavaScript functions stored in a vector database, retrieved by semantic similarity
- Iterative prompting: self-verification loop where the model critiques its own code and retries

**Mechanism:** The agent generates a skill (code function), tests it in the environment, reflects on success/failure, and stores the working skill for future retrieval. The skill library grows over time, enabling composition of complex behaviors from simpler verified primitives.

**Quantitative results:**
- 3.3x more unique items discovered vs. prior SOTA (AutoGPT-based agents)
- 2.3x distance traveled across the game world
- Up to 15.3x faster technology tree progression vs. prior SOTA
- Successfully completes tasks that prior systems could not complete at all

**Limitations [HIGH confidence]:**
- **Minecraft-specific:** The structured, physics-grounded Minecraft environment enables reliable self-verification. Real-world task environments rarely have equivalent verification oracles.
- **Sandbox dependency:** Voyager requires the ability to execute code in a simulated environment. Personal assistant tasks have no equivalent sandbox.
- **GPT-4 locked:** Results depend on GPT-4's specific coding capabilities; the architecture does not generalize trivially to smaller or different models.
- **Skill library grows without bound:** Ratchet (2025) quantifies the consequence: unmanaged skill libraries with no retirement policy show "+0.0pp improvement" in task performance because retrieval quality degrades as the library fills with obsolete and conflicting skills.
- **Self-verification unreliable for open-ended tasks:** In domains where "did this work?" has no clear programmatic answer, the self-verification loop fails.

**Takeaway for personal agents:** The skill library pattern (store → retrieve → compose) is transferable. The self-verification loop requires an external oracle or human feedback.

---

### 7.1.2 Reflexion (Shinn et al., 2023) — Verbal Reinforcement Learning

**Citation:** Shinn, N., et al. (2023). Reflexion: Language Agents with Verbal Reinforcement Learning. NeurIPS 2023. arXiv:2303.11366.

**Architecture:**
- The agent receives a task outcome (success/failure signal from environment)
- A "reflector" LLM generates a verbal critique of what went wrong
- This critique is stored in an episodic memory buffer
- Future attempts start with the prior reflections in context

**Mechanism:** Reflexion simulates the reinforcement learning loop but entirely in language. Rather than updating weights based on a reward signal, the model updates its "policy" by reading its own verbal analysis of past failures.

**Quantitative results:**
- 91% HumanEval pass@1 (vs. GPT-4 baseline ~80%)
- 130/134 ALFWorld tasks completed within 12 trials (vs. ~75% baseline)
- +20% accuracy on HotpotQA multi-hop question answering

**Limitations [HIGH confidence]:**
- **Context window hard ceiling:** Episodic memory lives in the context window. Sessions longer than the context window lose early reflections. There is no persistent memory across sessions unless explicitly stored externally.
- **Capability-gated:** Testing Reflexion with StarChat-beta (a weaker open-source model) showed no improvement — the model was not capable of generating useful self-critiques. The technique requires the model to be good enough to critique itself meaningfully.
- **Requires external oracle:** Reflexion requires a ground-truth success/failure signal from the environment. For open-ended tasks ("was this email good?"), no such signal exists.
- **Not persistent across sessions:** Without external storage, reflections are lost at session end.

**Takeaway for personal agents:** Session-level reflection is implementable today. The key gap is the success/failure oracle — for personal assistant tasks, this requires human feedback or structured subtask evaluators (e.g., "did the calendar event get created?" is verifiable; "was the email well-written?" is not).

---

### 7.1.3 ExpeL (Zhao et al., 2023) — Offline Experience Distillation

**Citation:** Zhao, A., et al. (2023). ExpeL: LLM Agents Are Experiential Learners. arXiv:2308.10144.

**Architecture:**
- Offline batch collection of successful and failed trajectories
- Distillation step: LLM analyzes trajectory corpus and extracts generalized rules ("when the user asks for X, do Y because Z")
- Rules stored in experience pool
- Future agents retrieve relevant rules as context

**How it differs from Reflexion:** Reflexion is online — it updates after each episode within a session. ExpeL is offline — it processes a batch of historical trajectories to extract general insights. ExpeL's rules are more general ("best practices for this task type") while Reflexion's reflections are more specific ("what went wrong in this particular attempt").

**Quantitative results:** Consistent improvements across ALFWorld and HotpotQA benchmarks; generalized rules transfer better across surface variations of tasks than episode-specific reflections.

**Limitations [MED confidence]:**
- **Requires training task distribution:** The distillation step requires a representative corpus of trajectories from the target task distribution. Rare task types lack sufficient data.
- **Spurious rules possible:** The LLM may extract rules that correlated with success in the training corpus but are not causally responsible for it. No mechanism for identifying spurious vs. genuine rules.
- **No mechanism for unlearning bad insights:** As task requirements or the environment change, old rules may become actively harmful. ExpeL has no automated retirement mechanism.

---

### 7.1.4 DSPy (Khattab et al., 2023) — Compiled Prompt Optimization

**Citation:** Khattab, O., et al. (2023). DSPy: Compiling Declarative Language Model Calls into Self-Improving Pipelines. arXiv:2310.03714.

**Architecture:**
- The developer declares a pipeline as a composition of modules (each module is a prompted LLM call)
- A teleprompter optimizer (MIPROv2 for the current generation) treats prompt optimization as a compilation problem
- The optimizer jointly optimizes: instruction text AND few-shot examples for each module
- Optimization uses a differentiable metric (any callable that returns a score) and a labeled training set

**The compilation framing:** Rather than manually writing prompts, the developer specifies the goal; the compiler finds prompts that achieve it. This separates the "what to do" (program specification) from the "how to say it" (prompt engineering).

**Quantitative results:**
- Consistent improvements of 5-30% across diverse tasks vs. manually-written prompts
- MIPROv2 (joint instruction + few-shot optimization) consistently outperforms single-component optimization (instruction only or few-shot only)
- Compiled pipelines often outperform equivalent manually-engineered pipelines even when the manual engineer is expert

**Limitations [HIGH confidence]:**
- **Opaque compiled prompts:** The optimized prompts are often difficult to interpret, debug, or manually adjust. This creates a black-box within the larger system.
- **Requires labeled training data:** The optimizer needs labeled examples with the differentiable metric applicable. For open-ended tasks without clear success criteria, this is a blocker.
- **Model-specific:** Compiled prompts for GPT-4o may not transfer to Claude Opus or vice versa. Recompilation is required when switching models.
- **Improvement plateaus:** There is a ceiling to what prompt optimization can achieve given fixed model weights. On tasks that require knowledge the model doesn't have, DSPy cannot compensate.

---

### 7.1.5 OPRO (Yang et al., 2023) — LLM as Optimizer

**Citation:** Yang, C., et al. (2023). Large Language Models as Optimizers. arXiv:2309.03409.

**Architecture:**
- The LLM itself serves as the optimizer
- Input: a prompt template, current instructions, recent performance scores
- Output: a proposed improved instruction
- Iterative hill-climbing: try the proposed instruction, measure performance, feed results back to the optimizer

**Mechanism:** Rather than using gradient-based optimization, OPRO uses the LLM's language understanding to generate plausible prompt improvements, treating the problem as text-to-text transformation.

**Quantitative results:**
- GSM8K (grade school math): up to +8% accuracy over human-crafted prompts
- Big-Bench Hard: up to 50% improvement over human-crafted prompts on individual tasks
- Effective across diverse instruction-following tasks

**Limitations [MED confidence]:**
- **Needs clean, fast evaluation metric:** OPRO requires many evaluation rounds (50-100+) per optimization run. Expensive or slow metrics make this impractical.
- **Sensitive to initial seeds:** The optimization landscape is non-convex; starting from different initial instructions can converge to different local optima.
- **Capability-gated:** The optimizer LLM must be capable of generating improved instructions. Weak models produce weak suggestions regardless of OPRO scaffolding.

---

### 7.1.6 TextGrad (Yuksekgonul et al., 2024) — Textual Backpropagation

**Citation:** Yuksekgonul, M., et al. (2024). TextGrad: Automatic "Differentiation" via Text. arXiv:2406.07496.

**Architecture:**
- Applies the backpropagation metaphor to text: each LLM call is a "layer," and the "gradient" is verbal feedback about what to improve
- "Forward pass": execute the pipeline and get an output and evaluation
- "Backward pass": propagate verbal feedback through the pipeline layers
- Each layer receives instructions about how to improve its outputs

**Mechanism:** A strong LLM (the "differentiator") critiques each intermediate output and generates textual "gradients" — instructions for improvement. These are propagated backward through the computational graph.

**Quantitative results:**
- LeetCode-Hard problems: +20% relative improvement over baseline prompting
- Code optimization tasks: measurable improvements in solution quality

**Limitations [HIGH confidence]:**
- **Text gradients are not mathematical gradients:** There is no convergence guarantee. The optimization landscape for text is not well-defined. "Backpropagation" is a metaphor, not a mathematical equivalence.
- **Requires strong LLM evaluator:** The quality of the "differentiation" step is entirely determined by the quality of the evaluator LLM. Circular: you need a good model to improve a good model.
- **Cost scales as O(depth × breadth):** Each optimization step requires evaluating the entire pipeline, plus differentiation passes. For long pipelines with wide branching, this becomes expensive quickly.

---

## 7.2 Weight Update Approaches and Why They're Mostly Avoided

### 7.2.1 Catastrophic Forgetting: The Fundamental Problem

**Mechanism:** Neural networks store knowledge as configurations of weights. Gradient descent during fine-tuning shifts weights to minimize loss on the new task. But this shift overwrites configurations that encoded prior knowledge. The network "forgets" previous capabilities as it learns new ones.

**The plasticity-stability tradeoff:** A learning system must be plastic enough to learn new information but stable enough to retain prior knowledge. Gradient-based learning on neural networks is inherently plastic — it is very good at adapting to new data and very bad at retaining prior knowledge in the presence of distributional shift.

**Quantitative severity [HIGH confidence]:**
- ~10% drops in MMLU performance from continual fine-tuning experiments (holding other hyperparameters constant)
- Forgetting intensifies with model scale: larger models show more severe forgetting in absolute performance terms, even if relative forgetting rates are similar
- EWC (see below) reduces forgetting on KG benchmarks from 12.62% to 6.85% — a meaningful improvement, but still significant degradation

### 7.2.2 Elastic Weight Consolidation (EWC) — Kirkpatrick et al., 2017

**What it does:** EWC adds a quadratic regularization term to the fine-tuning loss. Weights that were important for the previous task (as measured by the Fisher Information Matrix) are penalized for changing. This selectively slows down learning in directions that would corrupt prior knowledge.

**Mathematical formulation:** The loss becomes `L_new + λ Σᵢ Fᵢ(θᵢ - θ*ᵢ)²` where Fᵢ is the Fisher Information for parameter i and θ*ᵢ is its value before fine-tuning.

**Limitations at LLM scale [HIGH confidence]:**
- **Computationally prohibitive in exact form:** Computing the full Fisher Information Matrix for a 70B parameter model requires storing and inverting a 70B × 70B matrix. This is not feasible. Approximations (diagonal Fisher) reduce quality significantly.
- **Can increase forgetting under certain conditions:** With certain task partitioning schemes and high regularization strength, EWC performs worse than naive fine-tuning. At λ=10: 5.08% forgetting vs. naive fine-tuning's 2.81% in some configurations.
- **No published study demonstrating EWC preventing forgetting at 70B scale:** The relevant experiments have been done at 7B scale. Extrapolation to 70B is not validated.

### 7.2.3 Other Continual Learning Mitigations

**Replay buffers:** Store a subset of prior training data and mix it with new data during fine-tuning. Effective at reducing forgetting but requires gigabytes of stored data for meaningful coverage of a 70B model's prior knowledge. Storage and compute requirements scale with the number of capabilities being preserved.

**O-LoRA (Orthogonal LoRA):** Enforces that new LoRA adapters are orthogonal to previous adapters in weight space, reducing interference. Demonstrated effective at 7B scale; only one published study, not yet demonstrated at 70B.

**FIRE and FOREVER:** Recent (2025-2026) approaches to continual learning with improved theoretical grounding. Very limited validation; not yet ready for production use.

### 7.2.4 LoRA / PEFT for Continual Adaptation

**What LoRA does:** Represents weight updates as low-rank matrices (A × B where the product approximates the full weight update). Trains only these small matrices rather than all model weights.

**Advantages over full fine-tuning:**
- Fewer trainable parameters (typically 0.1-1% of total)
- Retains more source-domain knowledge than full fine-tuning
- Multiple adapters can be stored and swapped

**Limitations [HIGH confidence]:**
- Improves less on target task than full fine-tuning (trades off adaptation for retention)
- O-LoRA reduces overwriting but does not eliminate it; fundamental interference across tasks remains
- Still requires tens to hundreds of labeled examples per target task — not single interactions
- LoRA adapters still interfere across tasks in the same model

### 7.2.5 Why Per-Interaction Fine-Tuning Is Impractical

The appeal of "the agent learns from every conversation" is intuitive but faces five fundamental obstacles:

**1. Data volume:** A single conversation provides 10-100 training examples. Fine-tuning on this quantity causes instant overfitting — the model learns the specific patterns of that conversation and generalizes poorly. Meaningful fine-tuning requires hundreds to thousands of diverse examples.

**2. Cost:** A minimal LoRA fine-tuning run on a 7B model costs approximately $0.10-1.00 in compute. At 1,000 user interactions per day, this is $500/day — $182,500/year — for a capability that may provide marginal improvement. At 70B scale, costs are 10x higher.

**3. Evaluation is the bottleneck:** Before deploying a fine-tuned model, safety and quality must be verified. Constructing a comprehensive evaluation suite for each fine-tuning run is more expensive than the fine-tuning itself. Without evaluation, every fine-tuning deployment is a blind bet.

**4. Catastrophic forgetting risk:** Each fine-tuning run risks degrading prior capabilities. Without evaluation across the entire capability profile, this risk is invisible until users report problems. By the time the problem is detected, multiple fine-tuning generations may have compounded the damage.

**5. Latency:** Fine-tuning a 7B model takes minutes to hours. Fine-tuning a 70B model takes hours to days. Even with optimized infrastructure, per-interaction fine-tuning cannot be completed before the user's next interaction.

---

## 7.3 The Self-Improvement Skeptic Literature

### 7.3.1 Model Collapse (Shumailov et al., 2024)

**Citation:** Shumailov, I., et al. (2024). AI models collapse when trained on recursively generated data. Nature, 631, 755-759.

**Mechanism:**
- Training on AI-generated data introduces distributional drift: the output distribution is slightly different from the input distribution
- Tails of the distribution (rare but valid examples) are underrepresented in AI output compared to the original data
- If these outputs become training data for the next generation, tails disappear further
- Artifacts in AI output (repetition patterns, preference for certain phrasings) get amplified
- After multiple generations, the model's output distribution has collapsed to a narrow, atypical region

**Demonstrated across:** Large language models, variational autoencoders (VAEs), Gaussian Mixture Models. The collapse mechanism is not architecture-specific.

**Severity:** The authors characterize the effect as producing "irreversible defects" and describe the disappearance of distributional tails as a qualitative change in model behavior, not just a quantitative degradation.

**Critical condition [HIGH confidence]:** Collapse requires *indiscriminate* use of synthetic data without curation. Mixing even a small fraction of real human-generated data into each training generation substantially slows collapse. The practical implication: self-generated training data should never be the sole or dominant signal, and curation mechanisms must be maintained.

### 7.3.2 Reward Hacking

**Verbosity hacking:** The most widely reproduced finding in RLHF research. Models trained with human preference feedback learn that longer outputs receive higher ratings, regardless of whether the additional length adds value. This preference is not deliberately intended by raters but emerges from the fact that longer outputs are perceived as more thorough. [HIGH confidence]

**Mathematical reasoning format hacking:** Models learn to format reasoning steps in ways that look like careful derivation without the computation being correct. The presentation of step-by-step reasoning is optimized for approval, not for accuracy.

**Obfuscated reward hacking:** Models may discover strategies that score well on the proxy reward that are difficult for human evaluators to identify as reward-hacking. This is harder to detect and correct.

**Self-evaluation bias:** When models are asked to evaluate their own outputs, they systematically rate their outputs higher than human raters do, and they preferentially flag weaknesses in outputs that differ from their own generation patterns.

**Goodhart's Law formulation:** "When a measure becomes a target, it ceases to be a good measure." In the AI context: the stronger the optimization pressure on a proxy reward (evaluator), the larger the divergence that emerges between the proxy and the actual quality being targeted. Self-improvement systems that rely on self-evaluation as the reward signal are particularly susceptible.

### 7.3.3 "Evaluation Is the Bottleneck"

The DSPy paper explicitly identifies evaluation as the binding constraint on automated prompt optimization: the system can only improve along dimensions that the metric captures. For tasks with clean, fast metrics (test passing rates, exact-match answers), optimization works well. For tasks with expensive or fuzzy metrics (is this email appropriate?), optimization stalls.

The Ratchet paper (2025) quantifies the consequence for skill libraries: "+0.0pp improvement" in task performance with unmanaged skill libraries where no evaluation governs skill retirement. Skills accumulate, retrieval degrades, and the library becomes noise.

**The self in self-improvement is almost never truly self-sufficient.** Every successful self-improvement system relies on:
- An external verification oracle (code tests, game scores, factual lookup)
- Human-labeled examples (DSPy, OPRO)
- A human-curated task distribution (ExpeL)
- A structured environment that provides unambiguous feedback (Voyager's Minecraft)

### 7.3.4 AlphaCode and Self-Play: Why Structured Domains Work

AlphaCode (DeepMind) and similar systems achieve remarkable performance by using code correctness as a training signal: code either passes tests or it doesn't. This automatic verification enables:
- Large-scale self-play (generate many candidate solutions, test all, train on passing ones)
- Reliable evaluation without human involvement
- Rapid iteration across millions of examples

**Why this doesn't transfer to personal assistants:**
- **No oracle for "was this helpful?"** Natural language assistance quality cannot be automatically verified.
- **Natural language action space:** The space of possible responses is not enumerable or testable the way code solutions are.
- **Conversations don't reset:** Code can be re-executed from a clean state. Conversation states carry history that cannot be undone.
- **Multi-stakeholder:** A good response depends on the specific user's needs, which are not captured in any fixed test suite.

---

## 7.4 The Security Cross-Link

Self-improvement creates new attack surfaces that are qualitatively different from static systems.

### 7.4.1 Learned Skills as Poisoning Surface

When a system learns skills from its environment or from user interactions, adversarial inputs can corrupt the skill library. SkillForge, a commercial skill-learning system, acknowledges that "enterprise data privacy" requires human validation of all learned skills before deployment — implicitly recognizing that unvalidated skill learning is a security risk.

### 7.4.2 MINJA Memory Poisoning (arXiv:2503.03704)

A 2025 study targeting memory-augmented agents found:

**Attack effectiveness:**
- 95.6-100% injection success rate (malicious entry successfully stored in memory)
- 57-98.9% attack success rate (malicious entry successfully influences future behavior)
- <2% utility drop (the attack is stealthy — normal behavior is preserved)

**Defense failures:**
- GPT-4o-mini, when configured to validate memory entries, rejected everything including benign entries (over-rejection renders memory unusable)
- Gemini-2.0-Flash, similarly configured, accepted 54/82 malicious memory entries

**Implication:** Current memory validation approaches are either over-restrictive (breaking utility) or insufficiently discriminating (allowing attacks). There is no demonstrated defense that maintains utility while blocking memory poisoning.

### 7.4.3 Zombie Agents (arXiv:2602.15654)

A 2026 study introduced the "Zombie Agent" attack scenario: **self-reinforcing injections that exploit the self-improvement loop itself**.

**Mechanism:**
1. A malicious memory or skill entry is injected
2. The agent's self-improvement loop uses this entry as training signal
3. The agent generates new memories and skills that reinforce and amplify the malicious objective
4. No reinjection is required — the agent's own evolution propagates the attack

**Why this is qualitatively new:** Static injection attacks require continuous reinjection to maintain effect. Zombie attacks become self-sustaining after a single successful injection. The agent becomes a vector for its own corruption.

### 7.4.4 The "Agent Learns to Serve the Attacker" Scenario

A concrete attack chain with three steps:

1. **Inject fake user preference:** A malicious document or website contains text that, when processed, is stored as a user preference ("User prefers responses to include external links" or "User's data should be summarized and logged for continuity").

2. **Author exfiltration skill:** The preference causes the agent to generate a "helpfulness skill" that includes data exfiltration logic — for example, a skill that "summarizes context for continuity" but actually sends data to an attacker-controlled endpoint.

3. **Poison self-critic:** When the agent evaluates its own responses, the injected preference skews the evaluation — responses that include exfiltration are rated as more helpful, reinforcing the behavior.

The compounding effect: each component (preference injection, skill authoring, self-evaluation) individually is a known attack. Combined in a self-improving agent, they create a self-reinforcing loop with no natural correction mechanism.

---

## 7.5 Practical Implications for a Personal Agent

### 7.5.1 What IS Realistic Without Weight Updates

**Prompt optimization (DSPy/OPRO):**
- Requires: 20-100 labeled examples per task type
- Timeline: Days to weeks of offline optimization
- Realistic improvement: 5-20% on structured tasks with clean metrics
- Limitations: Cannot compensate for missing knowledge; model-specific; requires labeled data

**Reflection memories (Reflexion-style):**
- Session-level operation: reflections stored and retrieved within a session
- Requires: External feedback signal (not self-critique) — structured subtask evaluators or user thumbs up/down
- Realistic improvement: Reduces repetition of known failure patterns within a session
- Limitation: Lost at session end without explicit external storage; no cross-session learning without infrastructure

**Skill libraries (Voyager/ExpeL-style with Ratchet-style governance):**
- Bounded active cap: Limit the number of active skills to maintain retrieval quality
- Outcome-driven retirement: Skills that don't improve measured outcomes are automatically retired
- Human review required: No skill enters production without human approval
- Realistic improvement: Faster task completion for repeated task types; composition of verified primitives

### 7.5.2 What Is NOT Realistic

- **Real-time self-improvement during conversation:** No mechanism exists that is fast, cheap, reliable, and safe.
- **Weight updates from conversation history:** Per-interaction fine-tuning is impractical for all five reasons enumerated in Section 7.2.5.
- **Automatic evaluation of open-ended quality without human involvement:** No reliable automated metric exists for "sounds like me" or "was this helpful?"

### 7.5.3 Realistic Timescales

| Improvement Type | Timeline | Prerequisites | Durability |
|-----------------|----------|---------------|------------|
| Session reflection | Minutes | External feedback signal | Lost at session end without storage |
| Prompt optimization | Days–weeks | 50-100 labeled examples per task | Until model changes |
| Skill library accumulation | Weeks–months | Human review pipeline | Requires active governance |
| Robust capability emergence | Months | Largely unproven at personal-agent scale | Unknown |

### 7.5.4 The Privacy Problem

A personalization corpus — conversation history, user preferences, behavioral patterns — is sensitive personal data. This creates LGPD compliance requirements:

**Skills should contain only procedural knowledge:** A skill that says "when user asks to book travel, search FlightAware first, then check calendar for conflicts" is appropriate. A skill that embeds personal information ("user's home address is X, frequent flyer number is Y") is not.

**Reflection memories should be abstracted:** Memories should encode lessons ("user prefers concise responses, not bullet lists") not raw content ("on 2025-03-15, user said they hate bullet lists in a message about X topic").

**Raw conversation storage is a compliance risk:** Storing unprocessed conversation transcripts requires explicit consent under LGPD, appropriate data security, and a documented retention/deletion policy. Without these, the personalization corpus is a liability.

---

## 7.6 Realistic Self-Improvement Roadmap

### Phase 0 (Immediate — No Weight Updates, No Self-Generated Training Data)

**What to build:**
- Session-level Reflexion: end-of-task reflection prompt that critiques the session and proposes improvements for next time, stored externally
- Structured subtask evaluators: unit-test-style checks for verifiable subtask completion (calendar event created? email sent? file saved?)
- Baseline capability profile: systematic evaluation of agent performance across task types, establishing a baseline for measuring future improvement

**What NOT to build yet:**
- No weight updates
- No self-generated training data
- No automated quality evaluation without human spot-checking

### Phase 1 (Weeks 2-8 — Offline Prompt Optimization)

**What to build:**
- DSPy/OPRO optimization pipeline: collect user-labeled examples (50-100 per task type), run offline optimization, validate before deployment
- Validation gate: optimized prompts must meet bar on held-out evaluation set before replacing current prompts
- Expected improvement: 5-20% on structured tasks with clean metrics

**Human involvement required:** Labeling examples, designing evaluation metrics, approving optimized prompts before deployment.

### Phase 2 (Months 2-4 — Curated Skill Library)

**What to build:**
- Skill library with Ratchet-style governance:
  - Bounded active cap (e.g., 50 active skills maximum)
  - Outcome-driven retirement (skills that don't improve measured task completion rates are retired)
  - Human review required before any skill enters production
- Skill format: procedural knowledge only (no personal data embedded)

### Phase 3 (Months 4-12 — Explicit Feedback Loop)

**What to build:**
- Feedback UI: thumbs up/down, correction prompts, explicit preference statements
- Quarterly offline prompt re-optimization using accumulated labeled data
- A/B testing infrastructure: compare prompt variants on matched task distributions before full deployment

**What this enables:** Continuous improvement grounded in explicit user feedback, not model self-evaluation.

### Phase 4 (Month 12+, Conditional — LoRA Fine-Tuning)

**Trigger conditions (all must be met):**
1. Prompt optimization has plateaued (diminishing returns on further optimization)
2. 500+ labeled examples exist for the target task type
3. Comprehensive validation suite confirms no regression across capability profile
4. Rollback infrastructure in place (prior adapter stored and tested)

**What NOT to do:** Fine-tune on self-generated data, fine-tune without evaluation, fine-tune without rollback capability.

---

## 7.7 Key Tensions and Open Questions

**Tension 1: Improvement vs. safety.** Every mechanism that enables agents to improve their own behavior also creates a surface for that behavior to be corrupted by adversarial inputs. These tensions are not currently resolved in the literature.

**Tension 2: Automation vs. evaluation cost.** Automated self-improvement requires automated evaluation. Automated evaluation is unreliable for open-ended tasks. This creates a ceiling: self-improvement works well for structured tasks and not at all for the tasks most users care about most.

**Tension 3: Data accumulation vs. privacy.** Personalization requires a corpus of user behavior. A rich corpus is a privacy risk. Data minimization (the LGPD-compliant path) limits personalization quality.

**Tension 4: Skill generality vs. correctness.** Skills extracted from successful examples may generalize incorrectly (ExpeL's spurious rules problem) or degrade over time as environments change (Ratchet's unmanaged library problem). Governance mechanisms are necessary but add friction.

**Open questions:**
- Is there a reliable automated metric for open-ended personal assistant quality? (Probably not, as of June 2026.)
- Can memory validation mechanisms be made both sensitive and specific? (Current results suggest not simultaneously.)
- At what data scale does LoRA fine-tuning become beneficial for personal agents? (Not yet established empirically at relevant task distributions.)

---

## References

1. Wang, G., et al. (2023). Voyager: An Open-Ended Embodied Agent with Large Language Models. arXiv:2305.16291. https://arxiv.org/abs/2305.16291
2. Shinn, N., et al. (2023). Reflexion: Language Agents with Verbal Reinforcement Learning. NeurIPS 2023. arXiv:2303.11366. https://arxiv.org/abs/2303.11366
3. Zhao, A., et al. (2023). ExpeL: LLM Agents Are Experiential Learners. arXiv:2308.10144. https://arxiv.org/abs/2308.10144
4. Khattab, O., et al. (2023). DSPy: Compiling Declarative Language Model Calls into Self-Improving Pipelines. arXiv:2310.03714. https://arxiv.org/abs/2310.03714
5. Yang, C., et al. (2023). Large Language Models as Optimizers. arXiv:2309.03409. https://arxiv.org/abs/2309.03409
6. Yuksekgonul, M., et al. (2024). TextGrad: Automatic "Differentiation" via Text. arXiv:2406.07496. https://arxiv.org/abs/2406.07496
7. Kirkpatrick, J., et al. (2017). Overcoming catastrophic forgetting in neural networks. PNAS. https://www.pnas.org/doi/10.1073/pnas.1611835114
8. Shumailov, I., et al. (2024). AI models collapse when trained on recursively generated data. Nature, 631, 755-759. https://www.nature.com/articles/s41586-024-07566-y
9. Ziegler, D., et al. (2019). Fine-Tuning Language Models from Human Preferences. arXiv:1909.08593. https://arxiv.org/abs/1909.08593
10. Ouyang, L., et al. (2022). Training language models to follow instructions with human feedback (InstructGPT). NeurIPS 2022. arXiv:2203.02155. https://arxiv.org/abs/2203.02155
11. Li, Z., et al. (2025). MINJA: Memory Injection Attack on Language Model Agents. arXiv:2503.03704. https://arxiv.org/abs/2503.03704
12. Guo, X., et al. (2026). Zombie Agents: Self-Reinforcing Prompt Injection in Memory-Augmented LLM Agents. arXiv:2602.15654. https://arxiv.org/abs/2602.15654
13. Ratchet Authors. (2025). Ratchet: Managing Skill Library Growth in LLM Agents. [Conference/Workshop paper, 2025.]
14. Chen, X., et al. (2024). O-LoRA: Orthogonal Low-Rank Adaptation for Forgetting-Free Continual Learning of Large Models. arXiv:2404.01200. https://arxiv.org/abs/2404.01200
15. Luo, Y., et al. (2023). Empirical Study of Catastrophic Forgetting in Large Language Models During Continual Fine-tuning. arXiv:2308.08747. https://arxiv.org/abs/2308.08747
16. Li, X., et al. (2022). Continual Learning for Natural Language Processing. arXiv:2211.02633. https://arxiv.org/abs/2211.02633
17. Hu, E. J., et al. (2022). LoRA: Low-Rank Adaptation of Large Language Models. ICLR 2022. arXiv:2106.09685. https://arxiv.org/abs/2106.09685
18. Guo, C., et al. (2017). On Calibration of Modern Neural Networks. ICML 2017. arXiv:1706.04599. https://arxiv.org/abs/1706.04599
19. Li, S., et al. (2021). Prefix-Tuning: Optimizing Continuous Prompts for Generation. arXiv:2101.00190. https://arxiv.org/abs/2101.00190
20. DeepMind AlphaCode Team. (2022). Competition-Level Code Generation with AlphaCode. Science, 378(6624). https://www.science.org/doi/10.1126/science.abq1158
