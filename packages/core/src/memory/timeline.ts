import type { Pool } from 'pg';

import { normalizeRegistryName } from '../schema/common.js';
import { listTimeline } from '../store/observations.js';
import type { ListTimelineOptions, TimelineItem } from '../store/observations.js';

export type TimelineOptions = ListTimelineOptions;
export type TimelineEntry = TimelineItem;

/** Facts/events in reverse time order, optionally filtered to an entity, window, or types. */
export async function timeline(
  pool: Pool,
  options: TimelineOptions = {},
): Promise<TimelineEntry[]> {
  const types = options.types?.map(normalizeRegistryName);
  return listTimeline(pool, { ...options, types });
}
