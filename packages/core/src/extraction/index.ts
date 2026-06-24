export {
  extractFacts,
  OllamaExtractionLlm,
  type ExtractionLlm,
  type OllamaExtractionOptions,
} from './extractor.js';
export { applyProposal, type ApplyResult } from './apply.js';
export { extractionLlmFromEnv } from './config.js';
export {
  extractionProposalSchema,
  proposedEntitySchema,
  proposedObservationSchema,
  proposedRelationSchema,
  type ExtractionProposal,
  type ProposedEntity,
} from './types.js';
