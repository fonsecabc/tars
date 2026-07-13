// Chronicle adapters barrel — owned by the orchestrator. Per-harness adapters map
// harness-native records into log events. Builders create the modules; the orchestrator
// wires their exports here.
export * from './adapter.js';
export * from './voice.js';
export * from './whatsapp.js';
export * from './cron.js';
export * from './cc-shadow.js';
