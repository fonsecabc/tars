/**
 * Chronicle — cross-harness shared sessions. Public surface of the sessions module.
 *
 * Orchestrator-owned barrel. WU-0 exposes the frozen contract (`types.js`) and the (empty)
 * store namespace; later batches add the ops namespace + graph projector exports here.
 */
export * from './types.js';
export * as store from './store/index.js';
