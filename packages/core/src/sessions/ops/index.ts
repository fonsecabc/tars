// Chronicle ops barrel — owned by the orchestrator. Transactional write operations
// (append/open/checkpoint + lease claim/handoff/take-over) that own their transaction, gate
// by lane, and audit control-plane actions. Builders create the modules; the orchestrator
// wires their exports here.
export * from './append.js';
export * from './lease.js';
export * from './messaging.js';
