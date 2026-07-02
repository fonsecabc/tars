/**
 * Gold query set for the recall benchmark. Each case names the synthetic entity keys that a
 * good retriever should surface near the top. `kind` tags the signal under test so the
 * scorecard can break results down by query type (and expose overfitting to one dimension).
 *
 * Relevance is deliberately tight — only the entities a human would call a correct answer —
 * so precision and ranking, not just "did it appear somewhere", drive the score. Cases are
 * realistic personal-brain questions; they are NOT reverse-engineered from the retriever.
 */
export type CaseKind =
  | 'exact' // literal name match
  | 'alias' // matches an alias, not the canonical name
  | 'semantic' // paraphrase; query shares few/no tokens with the fact
  | 'attribute' // filter by a shared property (set-valued answer)
  | 'multihop' // answerable by following one relation
  | 'twohop' // answerable only by following two relations
  | 'collision' // two entities share a name token; only relations disambiguate
  | 'negative' // discriminate the right entity from a token-overlapping distractor
  | 'temporal'; // time / event framing

export interface EvalCase {
  id: string;
  kind: CaseKind;
  query: string;
  /** Synthetic entity keys (see fixtures.ts) that should rank in the top results. */
  relevant: string[];
}

export const GOLD: EvalCase[] = [
  // exact
  { id: 'e1', kind: 'exact', query: 'Ana Ferreira', relevant: ['ana'] },
  { id: 'e2', kind: 'exact', query: 'Globex Industries', relevant: ['globex'] },
  { id: 'e3', kind: 'exact', query: 'Grace Pinto', relevant: ['grace'] },
  // alias
  { id: 'a1', kind: 'alias', query: 'Apollo', relevant: ['apollo'] },
  { id: 'a2', kind: 'alias', query: 'ACME', relevant: ['acme'] },
  { id: 'a3', kind: 'alias', query: 'Umbra', relevant: ['umbra'] },
  // semantic / paraphrase
  {
    id: 's1',
    kind: 'semantic',
    query: 'who is in charge of the warehouse automation robot',
    relevant: ['ana', 'apollo'],
  },
  {
    id: 's2',
    kind: 'semantic',
    query: 'the startup founder who used to be at Acme',
    relevant: ['dan'],
  },
  { id: 's3', kind: 'semantic', query: 'the designer who is close with Ana', relevant: ['eve'] },
  { id: 's4', kind: 'semantic', query: 'flagship product of Acme', relevant: ['apollo'] },
  { id: 's5', kind: 'semantic', query: 'the person who founded a consultancy', relevant: ['dan'] },
  {
    id: 's6',
    kind: 'semantic',
    query: 'second in command of engineering at Acme',
    relevant: ['grace'],
  },
  // attribute (set-valued)
  { id: 't1', kind: 'attribute', query: 'engineers at Acme', relevant: ['ana', 'bob', 'alexr'] },
  {
    id: 't2',
    kind: 'attribute',
    query: 'who works at Globex',
    relevant: ['carla', 'frank', 'alexp'],
  },
  { id: 't3', kind: 'attribute', query: 'operations manager', relevant: ['carla'] },
  { id: 't4', kind: 'attribute', query: 'people based in Berlin', relevant: ['carla'] },
  { id: 't5', kind: 'attribute', query: 'recruiter at Acme', relevant: ['mia'] },
  // multi-hop (one relation)
  { id: 'm1', kind: 'multihop', query: "Bob's manager", relevant: ['ana'] },
  { id: 'm2', kind: 'multihop', query: "Ana's manager", relevant: ['grace'] },
  { id: 'm3', kind: 'multihop', query: 'projects run by Acme', relevant: ['apollo', 'orion'] },
  { id: 'm4', kind: 'multihop', query: 'who reports to Ana', relevant: ['bob'] },
  { id: 'm5', kind: 'multihop', query: "Dan's company", relevant: ['initech'] },
  { id: 'm6', kind: 'multihop', query: 'where is Acme headquartered', relevant: ['lisbon'] },
  { id: 'm7', kind: 'multihop', query: 'who works on Nova', relevant: ['hugo'] },
  { id: 'm8', kind: 'multihop', query: 'investor in Acme', relevant: ['umbra'] },
  // two-hop (two relations — baseline can't reach these by ranking)
  { id: 'h1', kind: 'twohop', query: 'who does Bobs manager report to', relevant: ['grace'] },
  { id: 'h2', kind: 'twohop', query: 'the VP who manages Bobs manager', relevant: ['grace'] },
  { id: 'h3', kind: 'twohop', query: "Ana's manager's other project", relevant: ['orion'] },
  {
    id: 'h4',
    kind: 'twohop',
    query: 'who leads the other Acme robotics project',
    relevant: ['grace', 'orion'],
  },
  {
    id: 'h5',
    kind: 'twohop',
    query: 'who attends the Globex summit',
    relevant: ['carla', 'frank'],
  },
  // collision (same name token; relations disambiguate)
  { id: 'c1', kind: 'collision', query: 'the Alex who works at Acme', relevant: ['alexr'] },
  { id: 'c2', kind: 'collision', query: 'Alex in marketing', relevant: ['alexp'] },
  { id: 'c3', kind: 'collision', query: 'the backend engineer Alex', relevant: ['alexr'] },
  { id: 'c4', kind: 'collision', query: 'Alex at Globex', relevant: ['alexp'] },
  // negative (discrimination against distractors)
  { id: 'n1', kind: 'negative', query: 'robotics company', relevant: ['acme'] },
  { id: 'n2', kind: 'negative', query: 'Zephyr routing platform', relevant: ['zephyr'] },
  { id: 'n3', kind: 'negative', query: 'friend of Ana', relevant: ['eve'] },
  // temporal / event
  { id: 'p1', kind: 'temporal', query: 'company offsite', relevant: ['offsite'] },
  { id: 'p2', kind: 'temporal', query: 'when does Apollo launch', relevant: ['apollo', 'launch'] },
  { id: 'p3', kind: 'temporal', query: 'Globex logistics summit', relevant: ['summit'] },
];
