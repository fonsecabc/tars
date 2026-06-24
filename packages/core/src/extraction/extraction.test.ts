import { applyProposal, createMemory, extractFacts, type ExtractionLlm } from '@tars/core';
import { closeTestPool, getTestPool, resetDb } from '@tars/core/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const pool = getTestPool();

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await closeTestPool();
});

const CANNED = JSON.stringify({
  entities: [
    { ref: 'a', type: 'Person', name: 'Person:A' },
    { ref: 'x', type: 'project', name: 'Project:X' },
  ],
  observations: [{ entityRef: 'a', text: 'leads the project' }],
  relations: [{ fromRef: 'a', toRef: 'x', predicate: 'Works On' }],
});

// Wraps the JSON in prose + a code fence to exercise the tolerant parser.
const fakeLlm: ExtractionLlm = {
  complete: () => Promise.resolve(`Sure! Here is the JSON:\n\`\`\`json\n${CANNED}\n\`\`\`\n`),
};

describe('fact extraction', () => {
  it('parses + validates a proposal, ignoring surrounding prose/fences', async () => {
    const proposal = await extractFacts('... free text about A and X ...', fakeLlm);
    expect(proposal.entities).toHaveLength(2);
    expect(proposal.observations[0]?.entityRef).toBe('a');
    expect(proposal.relations[0]?.predicate).toBe('Works On');
  });

  it('throws on a completion with no JSON object', async () => {
    const bad: ExtractionLlm = { complete: () => Promise.resolve('I could not find anything.') };
    await expect(extractFacts('x', bad)).rejects.toThrow();
  });

  it('applies a confirmed proposal via the write path', async () => {
    const memory = createMemory(pool);
    const proposal = await extractFacts('...', fakeLlm);

    const result = await applyProposal(memory, proposal);
    expect(result.entitiesCreated).toBe(2);
    expect(result.observationsAdded).toBe(1);
    expect(result.relationsAdded).toBe(1);

    const recalled = await memory.recall('project', { includeGraph: true });
    expect(recalled.entities.map((e) => e.entity.name)).toContain('Project:X');
    // Type + predicate were normalized to snake_case on write.
    expect(recalled.relations.some((r) => r.predicate === 'works_on')).toBe(true);
  });
});
