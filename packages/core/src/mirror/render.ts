import type { Entity, Observation, Relation, Uuid } from '../schema/index.js';

export interface EntityRef {
  type: string;
  name: string;
  /** Path relative to the mirror root, e.g. `entities/person/person-a-1a2b3c4d.md`. */
  path: string;
}

/** Stable, filesystem-safe slug derived from a name. Deterministic for clean git diffs. */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug.slice(0, 60) : 'untitled';
}

/** Path (relative to the mirror root) for an entity's Markdown file. */
export function entityFilePath(entity: { id: Uuid; type: string; name: string }): string {
  return `entities/${slugify(entity.type)}/${slugify(entity.name)}-${entity.id.slice(0, 8)}.md`;
}

/** JSON-encode a scalar for YAML frontmatter (JSON is valid YAML; safely quotes specials). */
function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function renderObservation(o: Observation): string {
  const period = o.validTo
    ? `${isoDay(o.validFrom)} → ${isoDay(o.validTo)}`
    : `since ${isoDay(o.validFrom)}`;
  const meta = [`source: ${o.source}`, `confidence: ${o.confidence.toFixed(2)}`];
  if (o.tags.length > 0) {
    meta.push(`tags: ${o.tags.join(', ')}`);
  }
  return `- **[${period}]** ${oneLine(o.text)} — _${meta.join(' · ')}_`;
}

/** Render one entity (with its observations and outgoing relations) to a Markdown document. */
export function renderEntity(
  entity: Entity,
  observations: Observation[],
  relations: Relation[],
  refs: Map<Uuid, EntityRef>,
): string {
  const lines: string[] = [
    '---',
    `id: ${entity.id}`,
    `type: ${yamlScalar(entity.type)}`,
    `name: ${yamlScalar(entity.name)}`,
    `aliases: ${JSON.stringify(entity.aliases)}`,
    `created_at: ${entity.createdAt.toISOString()}`,
    `updated_at: ${entity.updatedAt.toISOString()}`,
    '---',
    '',
    `# ${entity.name}`,
    '',
    `> **Type:** ${entity.type}` +
      (entity.aliases.length > 0 ? ` · **Aliases:** ${entity.aliases.join(', ')}` : ''),
    '',
    '## Observations',
    '',
  ];
  if (observations.length === 0) {
    lines.push('_None._');
  } else {
    for (const o of observations) {
      lines.push(renderObservation(o));
    }
  }
  lines.push('', '## Relations', '');
  if (relations.length === 0) {
    lines.push('_None._');
  } else {
    for (const r of relations) {
      const target = refs.get(r.toEntity);
      const link = target
        ? `[${target.name}](../${target.path.replace(/^entities\//, '')})`
        : `\`${r.toEntity}\``;
      lines.push(`- ${r.predicate} → ${link}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** Render the mirror index (`README.md`): counts and links grouped by entity type. */
export function renderIndex(
  entities: Entity[],
  refs: Map<Uuid, EntityRef>,
  generatedAt: Date,
): string {
  const byType = new Map<string, Entity[]>();
  for (const entity of entities) {
    const list = byType.get(entity.type) ?? [];
    list.push(entity);
    byType.set(entity.type, list);
  }
  const lines: string[] = [
    '# Tars memory mirror',
    '',
    `> Generated ${generatedAt.toISOString()} · ${entities.length} entities · ${byType.size} types`,
    '',
    'One-way export (DB → Markdown). Do not edit by hand — regenerated on each mirror run.',
    '',
  ];
  for (const type of [...byType.keys()].sort()) {
    const list = [...(byType.get(type) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    lines.push(`## ${type} (${list.length})`, '');
    for (const entity of list) {
      lines.push(`- [${entity.name}](${refs.get(entity.id)?.path ?? ''})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
