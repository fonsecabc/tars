# Track 2: Memory Systems for LLM-Based Agents (Priority Track)

> **Scope:** Literature through June 2026. Confidence tags: **[HIGH]**, **[MED]**, **[LOW]**. Fast-moving numbers date-stamped per section. This is the priority track — deepest coverage.

## 1. Numbered Reference List

[1] Packer, C. et al. "MemGPT: Towards LLMs as Operating Systems." arXiv:2310.08560, 2023. https://arxiv.org/abs/2310.08560

[2] Park, J. S. et al. "Generative Agents: Interactive Simulacra of Human Behavior." UIST 2023. https://arxiv.org/pdf/2304.03442

[3] Xu, W. et al. "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory." ECAI 2025. arXiv:2504.19413. https://arxiv.org/pdf/2504.19413

[4] Rasmussen, D. et al. "Zep: A Temporal Knowledge Graph Architecture for Agent Memory." arXiv:2501.13956, 2025. https://arxiv.org/abs/2501.13956

[5] Xu, W., Liang, Z. et al. "A-MEM: Agentic Memory for LLM Agents." arXiv:2502.12110, 2025. https://arxiv.org/pdf/2502.12110

[6] Edge, D. et al. "From Local to Global: A Graph RAG Approach to Query-Focused Summarization." Microsoft Research, 2024. https://arxiv.org/abs/2404.16130

[7] Liu, N. F. et al. "Lost in the Middle: How Language Models Use Long Contexts." TACL 2024. https://aclanthology.org/2024.tacl-1.9/

[8] Maharana, A. et al. "Evaluating Very Long-Term Conversational Memory of LLM Agents." arXiv:2402.17753, 2024. https://arxiv.org/abs/2402.17753

[9] Wu, X. et al. "LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory." ICLR 2025. https://github.com/xiaowu0162/LongMemEval

[10] Microsoft Research. "LazyGraphRAG." 2024. https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/

[11] Letta. "Sleep-time Compute." 2025. https://www.letta.com/blog/sleep-time-compute

[12] Yao, Z. et al. "Memory Poisoning Attack and Defense on Memory Based LLM-Agents." arXiv:2601.05504, 2025. https://arxiv.org/abs/2601.05504

[13] Gu, Y. et al. "A Survey on the Security of Long-Term Memory in LLM Agents." arXiv:2604.16548, 2025. https://arxiv.org/html/2604.16548v1

[14] Liu, X. et al. "Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers." arXiv:2603.07670, 2026. https://arxiv.org/html/2603.07670v1

[15] He, Z. et al. "U-NIAH: Unified RAG and LLM Evaluation for Long Context." arXiv:2503.00353, 2025. https://arxiv.org/abs/2503.00353

[16] Fabian, A. et al. "Anatomy of Agentic Memory." arXiv:2602.19320, 2026. https://arxiv.org/html/2602.19320v1

[17] Mastra Research. "Observational Memory: 95% on LongMemEval." 2026. https://mastra.ai/research/observational-memory

[18] Mem0. "State of AI Agent Memory 2026." April 2026. https://mem0.ai/blog/state-of-ai-agent-memory-2026

[19] Shereshevsky, A. "The GraphRAG Cost Cliff." Medium, 2025. https://medium.com/graph-praxis/the-graphrag-cost-cliff-how-33-000-became-33-in-eighteen-months-be1b0fbe37e4

[20] Li, Y. et al. "Governing Evolving Memory in LLM Agents." arXiv:2603.11768, 2026. https://arxiv.org/html/2603.11768v1

[21] Oymak, S. et al. "Hidden in Memory: Sleeper Memory Poisoning." arXiv:2605.15338, 2025. https://arxiv.org/html/2605.15338

[22] "MINJA: Memory INjection Attacks on LLM Agents." arXiv:2503.03704, 2025. https://arxiv.org/html/2503.03704

[23] "VoiceAgentRAG: Solving the RAG Latency Bottleneck." arXiv:2603.02206, 2025. https://arxiv.org/html/2603.02206v1

[24] Ravfogel, S. et al. "From BM25 to Corrective RAG." arXiv:2604.01733, 2026.

---

## 2. Memory Taxonomy

**[HIGH confidence for the four-type framework; MED for exact boundary definitions; June 2026]**

### Four-Type Taxonomy (Cognitive Analogy)

| Type | Agent Analog | Storage Location | Key Operations |
|---|---|---|---|
| **Working memory** | Active context window | In-context (RAM equivalent) | Read/write per inference step |
| **Episodic memory** | Conversation history, interaction logs | Vector store + recall DB | Retrieve by time or similarity |
| **Semantic memory** | World knowledge, user facts, domain knowledge | Vector/graph store | Retrieve by semantic query |
| **Procedural memory** | Code patterns, skills, verified workflows | Code repository, tool store | Execute; update on validation |

### How Contested Is This Taxonomy?

Three fault lines exist:

**1. Blurring of episodic and semantic.** When an agent "reflects" on episodes and derives general rules (as in Generative Agents [2]), the resulting abstractions are neither pure episodic nor pure semantic. Survey [14] handles this with an "episodic-semantic continuum." This is not universally adopted.

**2. Procedural memory is underspecified.** [14] explicitly notes procedural memory is the least studied type, lacking both consensus definitions and dedicated benchmarks. Most memory benchmarks ignore it entirely.

**3. Working memory conflation with context management.** Some papers treat the entire context window as working memory; others partition it into a "focus of attention" sub-region. This distinction matters for compaction strategy but is rarely formalized.

**4. The cognitive analogy is structural, not mechanistic** [13]. Risk: the framing licenses unwarranted inferences — e.g., that agent memory should "decay" like human memory (MemoryBank implements Ebbinghaus curves), when the actual computational rationale for decay is cost management, not biological fidelity.

---

## 3. Core Memory Systems

### 3.1 MemGPT / Letta [1, 11]

**Confidence: HIGH for mechanism; MED for benchmarks; LOW for production performance claims. Date-stamped 2023 paper, 2025 for Letta extensions.**

**Mechanism.** MemGPT applies OS virtual-memory principles to LLM context management. Three tiers:
- *Main context* ("RAM"): The active context window — system prompt, recent messages, currently paged-in records
- *Recall storage* ("disk"): Searchable database of all past messages; queried by the agent via function call (`archival_memory_search`)
- *Archival storage* ("cold storage"): Vector-indexed long-term document store

The agent itself issues function calls to move data between tiers. This is the key distinction from naive RAG: the model decides what to page in and out.

**What It Actually Improves vs. Naive RAG:**
- Can process documents exceeding context window (naive single-shot models truncate)
- Maintains biographical facts across multi-session chat

**Quantitative results from the original paper [1]:**
- Evaluation uses LLM-as-judge on synthetic tasks — no precision/F1 numbers
- Multi-session chat: qualitative improvement demonstrated; no single metric number

**Adversarial note:** The original MemGPT evaluation is largely qualitative or uses LLM-judge on custom tasks. No comparison against a well-tuned RAG baseline on a public benchmark in the original paper. DMR benchmark numbers (94.8% for Zep vs. 93.4% for MemGPT [4]) are from Zep's own paper.

**Sleep-time Compute (Letta 2025) [11]:**
Separate background agents reorganize memory asynchronously during idle periods, preventing memory management from adding latency to real-time turns. Specific delta numbers not peer-reviewed. **[LOW — industry blog claim]**

**Limitations:**
- Paging wrong data into context creates silent failures — the model gets slightly-wrong context without explicit error signals
- Function-call overhead adds latency per turn (the "agency tax": 32+ seconds per turn in worst hierarchical configurations [16])
- Self-directed memory management can create self-reinforcing errors

---

### 3.2 Generative Agents (Park et al. 2023) [2]

**Confidence: HIGH for architecture; LOW for quantitative claims about behavioral quality; date-stamped 2023.**

**Mechanism.** 25 agents in a simulated town. Each agent maintains:
- *Memory stream*: Chronological log of every observation, plan, and reflection in natural language
- *Retrieval function*: Combines recency, importance (LLM-scored 1–10), and relevance
- *Reflection*: Periodic synthesis of recent memories into higher-level abstractions
- *Planning*: Hierarchical decomposition — daily plan → hourly plan → moment-to-moment action

**What fails at scale:**
- Evaluation is almost entirely qualitative; believability assessed via crowdworkers (Likert scale) and LLM-as-judge
- 25 agents for 2 simulated days required multiple days of real compute and thousands of dollars in API costs
- LoCoMo benchmarking [8] later showed even best RAG systems score only 20.3% on temporal reasoning (vs. 92.6% human), suggesting behavioral coherence in Generative Agents may reflect shallow temporal cues

**Adversarial note:** The 2025 Springer review explicitly notes that "validation is the central challenge for generative social simulation" and that comparisons "vary in whether they are carried out in a rigorous quantitative way or in a more subjective way argued in narrative form." The paper is foundational but its claims about believability cannot be treated as rigorously measured.

---

### 3.3 Mem0 [3, 18]

**Confidence: HIGH for architecture; MED for ECAI 2025 numbers; LOW for 2026 blog scores. Date-stamped April 2026 for latest numbers.**

**Mechanism.** Selective extraction architecture:
1. At conversation end, LLM extracts key facts ("memories") rather than storing raw transcripts
2. Extracted facts stored in a graph-enhanced vector store
3. Multi-signal search: semantic similarity + BM25 + entity matching
4. Memory consolidation merges or supersedes contradictory memories

**Benchmark results (April 2026, blog-reported [18]):**

| Benchmark | Mem0 Score |
|---|---|
| LoCoMo | 92.5 |
| LongMemEval | 94.4 |
| BEAM (1M tokens) | 64.1 |
| BEAM (10M tokens) | 48.6 |

**Earlier (ECAI 2025) LongMemEval with GPT-4o:** Mem0 scored 49.0% vs. Zep's 63.8%. The gap between 49% (ECAI 2025) and 94.4% (blog, April 2026) reflects architectural improvements plus different model variants — **this discrepancy is unresolved; treat latest numbers with low confidence.**

**Limitations:**
- Selective extraction can miss low-frequency but high-importance facts
- Performance drops ~25% at 10M token scale [18]
- Memory staleness: high-relevance outdated facts remain confidently wrong without explicit invalidation

---

### 3.4 Zep / Graphiti [4]

**Confidence: HIGH for mechanism; MED for benchmarks (Zep's own paper); date-stamped January 2025.**

**Mechanism.** Zep's core engine is Graphiti, a temporally-aware knowledge graph:
1. Every fact node has `valid_from` and `valid_until` timestamps
2. Queries anchored to a point in time return the fact valid *then*, not the most recent similar embedding
3. Entity resolution tracks the same entity across unstructured conversation and structured business data
4. Hybrid retrieval: semantic embeddings + BM25 + direct graph traversal — no LLM inference at query time

**Why this beats vector-only for temporal queries:** A flat vector store retrieves the most semantically similar recent entry. If a preference changed ("I used to like spicy food but no longer do"), vector store may not know which entry is "current" relative to a specific time anchor. Graphiti maintains the *history* of that preference.

**Benchmark results [4]:**
- DMR (Deep Memory Retrieval): Zep 94.8% vs. MemGPT 93.4%
- LongMemEval: up to 18.5% accuracy improvement over baselines; ~90% lower response latency

**Adversarial note:** These numbers come from Zep's own paper. The DMR benchmark is a relatively narrow recall task. The LongMemEval comparison is against unspecified "baselines."

**Limitations:**
- Graph construction from unstructured text requires accurate entity extraction; smaller LLMs produce up to 30% format errors [16]
- Graph index grows super-linearly with corpus size
- Incremental updates to temporal graphs are complex without creating dangling or contradictory edges

---

### 3.5 A-MEM: Agentic Memory [5]

**Confidence: MED for mechanism; LOW for benchmark numbers; date-stamped February 2025.**

**Mechanism.** Zettelkasten-inspired note-taking system:
- Raw observations stored as interconnected note nodes with explicit semantic links to related memories
- Retrieval traverses the note graph rather than relying solely on top-k vector retrieval
- Hierarchical organization: raw observations → abstracted insights

**How it differs from MemGPT:** MemGPT compresses context via paging; A-MEM preserves structured relationships by maintaining explicit link structure.

**Limitations:** Maintaining link structure requires reliable LLM-generated metadata; quality degrades with weaker backbone models. Specific numeric results were not independently verifiable from available sources — treat quantitative claims from the paper directly.

---

## 4. Retrieval Methods

### 4.1 RAG Variants

**Confidence: HIGH for mechanism descriptions; MED for specific numbers; date-stamped 2024–2026.**

| Technique | Mechanism | When it wins | When it fails |
|---|---|---|---|
| **HyDE** | LLM generates hypothetical answer; embed that | Best on 5/8 conversational QA datasets [24] | Financial docs with precise numbers |
| **Multi-query** | Generate N query variants; union of top-k | ~7% improvement on multi-hop HotPotQA vs. HyDE [24] | Expensive; redundant for simple queries |
| **Step-back prompting** | LLM first abstracts query to a more general question | Principle-level knowledge retrieval | Loses specificity for precise entity lookups |
| **Contextual compression** | Post-retrieval: LLM compresses chunks to only relevant spans | Reduces noise in long passages | Adds latency; can cut relevant context |

**Top-performing combination [24]:** Hybrid BM25+dense retrieval with RRF re-ranking + cross-encoder reranker achieves Recall@5 of 0.816 vs. 0.695 for hybrid RRF alone.

---

### 4.2 GraphRAG [6, 10, 19]

**Confidence: HIGH for mechanism; HIGH for cost numbers; MED for quality claims; date-stamped 2024–2025.**

**Mechanism:**
1. Ingest all documents → LLM extracts entities and relationships → knowledge graph constructed
2. Leiden algorithm detects communities of densely-connected nodes
3. LLM pre-generates hierarchical community summaries offline
4. At query time: identify relevant communities → retrieve summaries → aggregate into final response

**When GraphRAG beats vector RAG:**
- Global, abstractive questions: "What are the main themes across all documents?"
- Multi-hop reasoning across entities: explicit edges reduce missed connections

**When vector RAG wins:**
- Simple fact lookup: GraphRAG's community traversal is wasteful overhead
- Real-time or budget-constrained systems: GraphRAG's 2–3× latency premium is prohibitive

**Cost trajectory [19]:**
- Early 2024: ~$33,000 to index a large dataset
- Mid-2025: Costs reduced to ~$33 via LazyGraphRAG and model efficiency improvements

**LazyGraphRAG [10]:** Defers LLM use to query time; uses NLP noun phrase extraction (not LLM) for indexing. At query time with budget=500: outperforms all methods on both local and global queries — 700× cheaper than full GraphRAG while matching quality.

**Limitations:**
- Knowledge graph extraction costs 3–5× more than baseline RAG
- Community summaries can hallucinate or drift from source material

---

### 4.3 BM25 / Sparse Retrieval

**Confidence: HIGH for benchmark numbers; date-stamped 2024–2025.**

**When sparse beats dense:**
- Exact entity matching: keyword/entity queries (product codes, proper names, rare terms)
- Financial/tabular documents: BM25 outperforms `text-embedding-3-large` on *every metric except Recall@20* in financial text-and-table retrieval [24]
- Low-resource or domain-specific vocabularies

**BEIR benchmark numbers:**
- BM25: 42.9 nDCG@10 (18-dataset average)
- SPLADE (learned sparse): 51.3 nDCG@10
- OpenAI `text-embedding-3-large`: 64.6 nDCG@10
- Qwen3-Embedding-8B: 70.6 nDCG@10

**Practical implication:** Hybrid retrieval (BM25 + dense, re-ranked with RRF) consistently outperforms either alone. Pure BM25 as a baseline is surprisingly competitive and much cheaper.

---

### 4.4 Vector Database Tradeoffs

**Confidence: MED — benchmarks vary by configuration and workload; date-stamped 2024–2026.**

| DB | Architecture | Latency (p50) | Scale sweet spot | Best for |
|---|---|---|---|---|
| **Pinecone** | Managed SaaS | <10ms | Any scale | Operational simplicity, consistent p99 |
| **Qdrant** | OSS + managed | ~4ms | Up to 100M vectors | Self-hosted, best latency, filtered search |
| **Weaviate** | OSS + managed | ~10–20ms | Mid-large | Hybrid search native, GraphQL API |
| **pgvector** | PostgreSQL ext. | Comparable to Qdrant at 1M | Up to ~10M | Teams already on Postgres |

**Key nuances:**
- pgvectorscale achieves 471 QPS at 50M vectors vs. Qdrant's 41.47 QPS at 99% recall — dramatic difference reflecting indexing strategy differences
- Most public benchmarks are run by vendors themselves. Configuration choices (HNSW ef, m parameters) dominate real-world performance more than DB choice.

---

## 5. Context Management

### 5.1 "Lost in the Middle" — Liu et al. 2023 [7]

**Confidence: HIGH for the phenomenon; HIGH for directional results; MED for exact degradation percentages; date-stamped 2023, confirmed in 2025 follow-ups.**

**Core finding:** LLM performance on multi-document QA follows a **U-shaped function of information position**: highest when relevant information is at the beginning or end, lowest when it is in the middle.

**Quantified degradation:**
- Performance degrades by **>30%** when relevant information is positioned in the middle vs. at beginning or end
- Replicated across 6 model families: GPT-3.5-Turbo, GPT-4, Claude 1.3, LongChat-13B, MPT-30B, Cohere Command
- Context lengths tested: 4K, 8K, 16K, 32K tokens — the U-curve exists at all lengths
- **2025 follow-up:** Confirmed to persist in models with 128K+ context windows

**Architectural root cause:** RoPE (Rotary Position Encoding) long-term decay property — dot-product similarity between distant token pairs decreases systematically, reducing attention weight on mid-context tokens.

**Implications for memory system design:**
- Never rely on the model to "notice" something buried in the middle of a large retrieved context
- Place highest-priority retrieved facts at the beginning or end of the prompt
- Sub-agent isolation (giving each sub-agent a focused small context) addresses it architecturally

---

### 5.2 Long-Context Models vs. Retrieval [15]

**Confidence: MED — field is evolving rapidly; date-stamped 2025–2026.**

**U-NIAH findings [15]:**
- RAG achieves **82.58% win-rate** over long-context LLMs for smaller models on needle-in-haystack tasks
- Advanced reasoning LLMs show **reduced RAG compatibility** — sensitivity to semantic distractors in retrieved passages causes more errors

**When long-context wins:**
- Corpus fits entirely in context (<200K tokens for Claude 3.5; <1M for Gemini 1.5/2.0)
- Queries require holistic understanding across the entire corpus
- Retrieval quality is low (noisy retriever introduces more errors than a full read)

**When retrieval wins:**
- Corpus exceeds context window
- Queries are factual lookups not requiring holistic synthesis
- Cost is a constraint: reading 1M tokens per query is expensive; retrieval reads ~1–10K tokens

---

### 5.3 Compaction / Summarization Strategies

**Confidence: MED; date-stamped 2025–2026.**

**Sliding window with summarization:** Oldest portion of context replaced with LLM-generated summary when context exceeds threshold. Risk: iterative summarization causes **semantic drift** — mild preferences like "I like mild spicy food" can progressively become "loves very spicy food" over many compaction cycles [20]. Formal bound: drift scales as O(T·ε_step) without governance; with periodic reconciliation every N steps, bounded at O(N·ε_step).

**Observational Memory (Mastra 2026) [17]:** A background Observer agent converts messages to dated, dense observations (3–6× compression). A Reflector condenses accumulated observations when they exceed thresholds. Achieves 94.87% on LongMemEval with gpt-5-mini.

**Sub-agent isolation:** Each sub-agent operates in its own focused context. The orchestrator maintains a compact shared memory. Prevents context rot from accumulating across unrelated tasks.

**Critical statistic:** ~65% of enterprise AI failures in 2025 were attributed to context drift or memory loss during multi-step reasoning (Zylos Research estimate; not peer-reviewed, treat as directional).

---

## 6. Benchmarks

### 6.1 LongMemEval [9, 17]

**Confidence: HIGH for design; HIGH for Mastra scores; date-stamped ICLR 2025 / 2026 scores.**

**What it measures:** 500 evaluation instances from extended user-assistant dialogues. Five core memory abilities:
1. Single-session information extraction
2. Multi-session reasoning
3. Knowledge updates (tracking changed information)
4. Temporal reasoning
5. Abstention (declining when answer unavailable)

**SOTA performance (June 2026):**

| System | Model | Score | Notes |
|---|---|---|---|
| Observational Memory [17] | gpt-5-mini | 94.87% | Highest ever recorded |
| Mem0 [18] | (unspecified, Apr 2026) | 94.4% | Blog-reported |
| Observational Memory [17] | gpt-4o | 84.23% | +24 pts over full-context |
| Zep [4] | (2025 paper) | 63.8% | Earlier comparison |
| Mem0 [3] | GPT-4o (ECAI 2025) | 49.0% | Earlier comparison |

**Adversarial note:** Observational Memory *beats the oracle baseline* (84.23% for gpt-4o). This suggests the full-session context introduces noise that even the oracle configuration suffers from — or that OM's summary representation is a superior retrieval surface than raw sessions.

---

### 6.2 LoCoMo [8]

**Confidence: HIGH for benchmark design and original results; date-stamped 2024 paper.**

**What it measures:** Very long-term conversational memory across extended relationships spanning months.

**Dataset:**
- 50 conversations, average 304.9 turns, 9,209 tokens per conversation
- Average 19.3 sessions (up to 35 sessions)
- ~32.3 images per conversation
- Three tasks: QA, event summarization, multimodal dialogue generation

**Key results from Maharana et al. 2024 [8]:**
- Best model (GPT-3.5-turbo-16K): 37.8% F1 on QA
- Human baseline: 87.9% F1
- **Temporal reasoning specifically: models score only 20.3% vs. human 92.6%**
- Adversarial questions: long-context models drop to **2.1%** accuracy
- Long-context models show a **14% performance decline** on event summarization despite larger context windows (more context ≠ better summary)

**Later scores (Mem0 blog, April 2026):** 92.5 on LoCoMo — a dramatic improvement over the 37.8% F1 in 2024, reflecting better models and memory architectures. **Direct comparison requires caution: metrics may differ.**

---

### 6.3 Other Benchmarks

| Benchmark | Focus | Key finding |
|---|---|---|
| **DMR (Deep Memory Retrieval)** | Single-fact recall from long conversation | Zep: 94.8%, MemGPT: 93.4% [4] |
| **MemoryArena** | Multi-session agentic tasks requiring active memory use | Models at ~80% on LoCoMo drop to 40–60% here [14] |
| **BEAM** | Scales to 1M and 10M tokens | Mem0: 64.1% at 1M, 48.6% at 10M [18] |

**Critical gap [14]:** Models scoring near-perfectly on LoCoMo "plummet to 40–60%" in MemoryArena. This exposes the distinction between *passive recall* (answering questions about memory) and *decision-relevant memory use* (acting on memory in a running agent loop). Most benchmarks measure the former; production agents require the latter.

---

## 7. Memory as a Poisoning Surface [12, 13, 21, 22]

**Confidence: HIGH — multiple independent papers confirm; date-stamped 2025.**

**MINJA (query-only injection) [22]:** Attacker poisons memory via normal user queries — no elevated privileges required. Attack success rate: **>95%** injection success. Injections are semantically plausible and hard to detect: LLM-based detectors miss **66%** of poisoned entries since they appear harmless in isolation.

**Sleeper memory poisoning [21]:** Single adversarial exposure poisons future behavior. The malicious intent only activates in specific later contexts — one-to-many effect. Advanced LLM detectors miss it in isolation.

**Why this is harder than prompt injection:** Persistence (effects last across sessions), statefulness (behavioral drift accumulates), and propagation (multi-agent systems allow cross-agent contamination) [13].

**SSGM Defense framework [20]:**
- Pre-consolidation validation: Truth Maintenance System checks proposed memory writes
- Cryptographic provenance + Weibull decay functions for temporal trust
- Access-scoped retrieval (identity-based isolation)
- Reversible reconciliation: dual-track storage (mutable active graph + immutable episodic log)

**Bottom line for production:** Memory is an attack surface that most production deployments treat as trusted storage. Treat every write path as potentially adversarial.

---

## 8. Retrieval Latency Budget

**Confidence: HIGH for voice/chat budget numbers; MED for specific system measurements; date-stamped 2025–2026.**

| Agent type | Total response budget | Memory retrieval budget |
|---|---|---|
| Voice AI | <800ms total | <100ms (50ms target) |
| Conversational chat | ~200ms | 50–100ms |
| Enterprise copilot (async) | <3 seconds | 200–400ms |

**Measured system latencies:**
- Traditional RAG with Qdrant Cloud: 110.4ms average
- VoiceAgentRAG with FAISS in-memory cache: 0.35ms [23]
- MemoryOS (hierarchical paging): >32 seconds [16] — catastrophically slow for real-time use
- Zep hybrid retrieval: ~90% latency reduction claimed vs. baseline [4]

**The "agency tax" [16]:** Latency varies by 1–2 orders of magnitude across architectures. For real-time agents, architectural latency is as important as retrieval accuracy.

**Latency budget breakdown for a retrieval call:**
1. Query processing and embedding: 10–50ms
2. Similarity search: 4–110ms depending on DB and scale
3. Reranking (if cross-encoder): 50–150ms additional
4. Context assembly and compression: 10–50ms

**Implication:** Full hybrid retrieval + cross-encoder reranking (the highest-accuracy combination) typically exceeds voice latency budgets. Production voice agents use caching (FAISS in-memory) or skip reranking.

---

## 9. What to Store vs. Summarize vs. Discard

**No consensus exists.** Practical heuristics from the literature:

**Store verbatim:**
- User-stated preferences, identity facts, stated constraints ("I am vegetarian")
- Explicit commitments or decisions
- Structured data (numbers, dates, entity attributes) — summarization degrades precision

**Summarize:**
- Episodic context after a threshold of turns
- Task history where the outcome matters more than the steps
- Redundant observations sharing a common abstraction

**Discard:**
- Transient operational context (intermediate reasoning steps with no future relevance)
- Superseded facts (but maintain an audit log for poisoning defense)
- Low-importance episodic events

**The unsolved problem:** Deciding what will be important in the future requires future knowledge. Survey [14] calls this the "principled consolidation" problem: no system has solved it without human-specified importance signals or domain-specific rules.

---

## 10. Key Tensions and Open Questions

### T1: Benchmark Saturation vs. Real Memory Measurement

As context windows grow to 128K–1M tokens, many "memory" benchmarks fit entirely in-context, eliminating the need for external memory. Papers claiming superiority on these benchmarks may be measuring artifacts. **The field needs benchmarks that are provably non-solvable by stuffing everything in context.**

### T2: Passive Recall vs. Decision-Relevant Memory Use

The MemoryArena finding — models drop from ~80% on LoCoMo to 40–60% in agentic task completion — is the clearest evidence that memory recall and memory use are different capabilities. Almost all current benchmarks measure recall. Production agents require use. **This is an open evaluation gap.**

### T3: Accuracy vs. Latency

The highest-accuracy retrieval pipeline (hybrid BM25+dense + cross-encoder reranker) is too slow for real-time voice. The fastest (in-memory FAISS) sacrifices accuracy and doesn't scale. **No current system simultaneously achieves SOTA accuracy, sub-100ms latency, and billion-scale capacity.**

### T4: Memory Governance vs. Usability

Proper memory governance (cryptographic provenance, access-scoped retrieval, reversible reconciliation) [20] would significantly increase system complexity and latency. No production system currently implements all nine governance primitives identified in [13]. Memory poisoning is a realistic attack with >95% success rates and almost no deployed defenses.

### T5: Self-Reinforcing Error in Reflective Memory

When agents reflect and consolidate memories, errors can be entrenched. A false belief written to semantic memory will be retrieved and used in future reasoning. **Forgetting quality** — the ability to selectively obsolete wrong memories — is essentially unresearched despite being critical for long-running production agents [14].

### T6: Production vs. Paper Claims — A Systematic Pattern

| System | Issue |
|---|---|
| MemGPT [1] | No precision/F1 in original paper; LLM-judge on custom tasks |
| Generative Agents [2] | Qualitative evaluation; crowdworker believability ratings |
| GraphRAG [6] | Original indexing cost $33K per dataset |
| Mem0 [3/18] | 49% → 94% jump between ECAI 2025 and April 2026 blog is unexplained |
| Zep [4] | DMR and LongMemEval comparisons are from Zep's own paper |

The call for a "GLUE-style leaderboard" for agent memory [14] is well-founded and overdue.

### Open Questions

1. **How do you consolidate without future-sight?** Principled compression requires knowing what will be needed later — an oracle problem.
2. **How do you prevent reflective memory from entrenching errors?** External validation and adversarial probing are proposed but not implemented at scale.
3. **What is the right forgetting policy for compliance?** LGPD/GDPR require deletion; immutable episodic logs create compliance complexity.
4. **How does memory scale in multi-agent systems?** Concurrent writes, access control, and knowledge transfer between specialized agents are largely unstudied.
5. **How do you evaluate memory in embodied/multimodal agents?** All current benchmarks are text-only.

---

*Review compiled June 2026. All confidence tags are author's assessment based on evidence strength, replication status, and adversarial scrutiny.*
