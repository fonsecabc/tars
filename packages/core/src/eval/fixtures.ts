import type { Memory } from '../memory/facade.js';

/**
 * A synthetic "brain" for benchmarking recall. Every entity is an abstract placeholder (no
 * real personal data — see CLAUDE.md golden rules). The graph is designed to be
 * DISCRIMINATIVE: hard negatives (entities sharing tokens with the wrong answer), name
 * COLLISIONS (two people named "Alex", disambiguated only by their relations), single- and
 * TWO-hop relational chains (Bob → Ana → Grace), and paraphrasable facts (whose name/keywords
 * don't overlap the natural query). A naive retriever fails the relational/collision cases; a
 * graph- and lexically-aware one recovers them — which is exactly the gap the benchmark measures.
 */

interface SeedEntity {
  key: string;
  type: string;
  name: string;
  aliases?: string[];
  observations: string[];
}

interface SeedRelation {
  from: string;
  to: string;
  predicate: string;
}

const ENTITIES: SeedEntity[] = [
  // Organizations
  {
    key: 'acme',
    type: 'organization',
    name: 'Acme Corp',
    aliases: ['Acme', 'ACME'],
    observations: [
      'A mid-size robotics company',
      'Headquartered in Lisbon',
      'Builds warehouse automation hardware',
    ],
  },
  {
    key: 'globex',
    type: 'organization',
    name: 'Globex Industries',
    aliases: ['Globex'],
    observations: [
      'A logistics and shipping conglomerate',
      'A rival of Acme on some robotics contracts',
    ],
  },
  {
    key: 'initech',
    type: 'organization',
    name: 'Initech',
    observations: ['A small software consultancy startup'],
  },
  {
    key: 'umbra',
    type: 'organization',
    name: 'Umbra Capital',
    aliases: ['Umbra'],
    observations: ['A venture capital firm', 'An early investor in Acme'],
  },
  // People
  {
    key: 'ana',
    type: 'person',
    name: 'Ana Ferreira',
    aliases: ['Ana'],
    observations: [
      'Lead engineer at Acme',
      'Runs the Apollo project',
      'Speaks Portuguese and English',
    ],
  },
  {
    key: 'bob',
    type: 'person',
    name: 'Bob Santos',
    aliases: ['Bob'],
    observations: ['Junior engineer at Acme', 'Reports to Ana'],
  },
  {
    key: 'carla',
    type: 'person',
    name: 'Carla Mendes',
    aliases: ['Carla'],
    observations: ['Operations manager at Globex', 'Based in Berlin'],
  },
  {
    key: 'dan',
    type: 'person',
    name: 'Dan Oliveira',
    aliases: ['Dan'],
    observations: ['Founder of Initech', 'Previously worked at Acme', 'Lives in Porto'],
  },
  {
    key: 'eve',
    type: 'person',
    name: 'Eve Costa',
    aliases: ['Eve'],
    observations: ['A close friend of Ana', 'Works as a freelance designer'],
  },
  {
    key: 'frank',
    type: 'person',
    name: 'Frank Lima',
    aliases: ['Frank'],
    observations: ['Sales lead at Globex'],
  },
  {
    key: 'grace',
    type: 'person',
    name: 'Grace Pinto',
    aliases: ['Grace'],
    observations: ['VP of Engineering at Acme', "Ana's manager"],
  },
  {
    key: 'hugo',
    type: 'person',
    name: 'Hugo Reis',
    aliases: ['Hugo'],
    observations: ['Data scientist at Initech', 'Works on Project Nova'],
  },
  {
    key: 'alexr',
    type: 'person',
    name: 'Alex Rocha',
    aliases: ['Alex Rocha'],
    observations: ['Backend engineer at Acme'],
  },
  {
    key: 'alexp',
    type: 'person',
    name: 'Alex Prado',
    aliases: ['Alex Prado'],
    observations: ['Marketing manager at Globex'],
  },
  {
    key: 'ivan',
    type: 'person',
    name: 'Ivan Melo',
    aliases: ['Ivan'],
    observations: ['An independent contractor', 'Splits time between Apollo and Zephyr'],
  },
  {
    key: 'mia',
    type: 'person',
    name: 'Mia Torres',
    aliases: ['Mia'],
    observations: ['Technical recruiter at Acme'],
  },
  // Projects
  {
    key: 'apollo',
    type: 'project',
    name: 'Project Apollo',
    aliases: ['Apollo'],
    observations: [
      "Acme's flagship warehouse-automation robot",
      'Led by Ana',
      'Launches in the third quarter',
    ],
  },
  {
    key: 'orion',
    type: 'project',
    name: 'Project Orion',
    aliases: ['Orion'],
    observations: ["Acme's second robotics initiative", 'Led by Grace'],
  },
  {
    key: 'zephyr',
    type: 'project',
    name: 'Project Zephyr',
    aliases: ['Zephyr'],
    observations: ["Globex's fleet-routing optimization platform"],
  },
  {
    key: 'nova',
    type: 'project',
    name: 'Project Nova',
    aliases: ['Nova'],
    observations: ["Initech's internal analytics tool"],
  },
  // Places
  {
    key: 'lisbon',
    type: 'place',
    name: 'Lisbon',
    observations: ['Capital of Portugal', 'Where Acme is headquartered'],
  },
  { key: 'berlin', type: 'place', name: 'Berlin', observations: ['Capital of Germany'] },
  { key: 'porto', type: 'place', name: 'Porto', observations: ['A coastal city in Portugal'] },
  // Trip
  {
    key: 'offsite',
    type: 'trip',
    name: 'Lisbon Offsite',
    observations: ['A company offsite in Lisbon in October', 'Ana and Bob are attending'],
  },
  // Events
  {
    key: 'summit',
    type: 'event',
    name: 'Globex Logistics Summit',
    observations: ["Globex's annual logistics summit", 'Held in Berlin'],
  },
  {
    key: 'launch',
    type: 'event',
    name: 'Apollo Launch Day',
    observations: ['The public launch of Project Apollo', 'Scheduled for the third quarter'],
  },
];

const RELATIONS: SeedRelation[] = [
  { from: 'ana', to: 'acme', predicate: 'works_at' },
  { from: 'bob', to: 'acme', predicate: 'works_at' },
  { from: 'alexr', to: 'acme', predicate: 'works_at' },
  { from: 'grace', to: 'acme', predicate: 'works_at' },
  { from: 'mia', to: 'acme', predicate: 'works_at' },
  { from: 'grace', to: 'ana', predicate: 'manages' },
  { from: 'ana', to: 'bob', predicate: 'manages' },
  { from: 'carla', to: 'globex', predicate: 'works_at' },
  { from: 'frank', to: 'globex', predicate: 'works_at' },
  { from: 'alexp', to: 'globex', predicate: 'works_at' },
  { from: 'dan', to: 'initech', predicate: 'founded' },
  { from: 'dan', to: 'acme', predicate: 'previously_worked_at' },
  { from: 'hugo', to: 'initech', predicate: 'works_at' },
  { from: 'hugo', to: 'dan', predicate: 'reports_to' },
  { from: 'hugo', to: 'nova', predicate: 'works_on' },
  { from: 'eve', to: 'ana', predicate: 'friend_of' },
  { from: 'ana', to: 'apollo', predicate: 'leads' },
  { from: 'grace', to: 'orion', predicate: 'leads' },
  { from: 'ivan', to: 'apollo', predicate: 'works_on' },
  { from: 'ivan', to: 'zephyr', predicate: 'works_on' },
  { from: 'apollo', to: 'acme', predicate: 'part_of' },
  { from: 'orion', to: 'acme', predicate: 'part_of' },
  { from: 'zephyr', to: 'globex', predicate: 'part_of' },
  { from: 'nova', to: 'initech', predicate: 'part_of' },
  { from: 'umbra', to: 'acme', predicate: 'invests_in' },
  { from: 'acme', to: 'lisbon', predicate: 'located_in' },
  { from: 'carla', to: 'berlin', predicate: 'lives_in' },
  { from: 'dan', to: 'porto', predicate: 'lives_in' },
  { from: 'offsite', to: 'lisbon', predicate: 'located_in' },
  { from: 'summit', to: 'berlin', predicate: 'located_in' },
  { from: 'launch', to: 'apollo', predicate: 'part_of' },
  { from: 'ana', to: 'offsite', predicate: 'attends' },
  { from: 'bob', to: 'offsite', predicate: 'attends' },
  { from: 'carla', to: 'summit', predicate: 'attends' },
  { from: 'frank', to: 'summit', predicate: 'attends' },
];

export interface SeededBrain {
  /** Stable synthetic key → real entity UUID. */
  idByKey: Map<string, string>;
  /** Real entity UUID → stable synthetic key (for scoring retrieved results). */
  keyById: Map<string, string>;
  entityCount: number;
  relationCount: number;
}

/**
 * Seed the synthetic brain through the {@link Memory} facade — the same write path production
 * uses, so observations get embedded on write when an embedding provider is active.
 */
export async function seedSyntheticBrain(memory: Memory): Promise<SeededBrain> {
  const idByKey = new Map<string, string>();
  const keyById = new Map<string, string>();

  for (const e of ENTITIES) {
    const result = await memory.remember({
      entity: { type: e.type, name: e.name, aliases: e.aliases ?? [] },
      observations: e.observations.map((text) => ({ text })),
      source: 'manual',
    });
    idByKey.set(e.key, result.entity.id);
    keyById.set(result.entity.id, e.key);
  }

  let relationCount = 0;
  for (const r of RELATIONS) {
    const from = idByKey.get(r.from);
    const to = idByKey.get(r.to);
    if (from === undefined || to === undefined) {
      throw new Error(`Seed relation references unknown key: ${r.from} -> ${r.to}`);
    }
    await memory.link({ fromEntity: from, toEntity: to, predicate: r.predicate });
    relationCount += 1;
  }

  return { idByKey, keyById, entityCount: ENTITIES.length, relationCount };
}
