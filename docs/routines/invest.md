# Routine: Invest (long-term advisor)

An abstract, placeholder-safe description of the long-term investing routine. The
personal, runnable version lives outside the repo (`~/tars-invest.md`); the engine is
in `finance/`. No personal data here.

## What it is
A weekly routine that reviews a long-term portfolio against a **target policy
allocation**, measures drift, and produces one advisory digest: where to direct new
contributions, what (if anything) to rebalance, and any planning flags. It is
deliberately boring — the evidence is that asset allocation drives ~90% of long-run
return variability and most active strategies lose to a low-cost index over 10-15y.

## Advisory only
This routine **never trades**. It computes and proposes; the operator decides and
executes. Every suggestion is a proposal to approve later.

## The cycle
1. Assemble current holdings from memory (and a bank/Open-Finance sync where wired),
   bucketed by asset class (cash / domestic fixed income / domestic equity / global
   equity / crypto).
2. Run the deterministic analyzer (`portfolio.py`): drift vs the profile's target
   weights, a rebalancing band, and **contribution-first** rebalancing (direct new money
   to underweights rather than selling — avoids realising taxable gains).
3. Ground the numbers in the operator's real situation and name concrete instruments.
4. Surface planning flags — notably cross-border **tax/relocation** consequences (e.g. a
   move that turns domestic funds into punitive foreign-fund holdings), as a flag to
   confirm with a professional, never blind advice.
5. Deliver an advisory digest; capture durable facts (holdings, contributions, decisions)
   to memory.

## Policy profiles
Target weights are defined per risk profile (conservative / moderate / aggressive) in
`portfolio.py`. The active profile is a per-operator setting.

## Schedule
Weekly. Monthly is also reasonable.
