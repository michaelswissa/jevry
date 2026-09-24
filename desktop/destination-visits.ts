import type { JevRequest } from './engine';

export interface PriorDestinationObservation {
  last_observed_step: number;
  visit_count: number;
}

const MAX_DESTINATIONS = 128;
const POLICY = 'prior_observation describes retained observations of this exact URL, not proof of task completion. Reinspection is allowed when useful; absent hints do not mean unvisited.';

/** Per-turn observed URL transitions, never attempted clicks or inferred reads. */
export class DestinationVisits {
  private readonly destinations = new Map<string, PriorDestinationObservation>();
  private previousUrl?: string;

  observe(url: string, step: number) {
    if (!Number.isSafeInteger(step) || step < 0) return;
    const transition = url !== this.previousUrl;
    this.previousUrl = url;
    try { if (!['http:', 'https:'].includes(new URL(url).protocol)) return; }
    catch { return; }
    const previous = this.destinations.get(url);
    // Retain exact counts for known destinations. Once full, omit new URLs
    // instead of evicting history and later presenting an incomplete count.
    if (!previous && this.destinations.size >= MAX_DESTINATIONS) return;
    this.destinations.set(url, {
      last_observed_step: step,
      visit_count: (previous?.visit_count || 0) + Number(transition),
    });
  }

  /** Annotate existing click alternatives only. No action, target or evidence changes. */
  annotate(request: JevRequest): void {
    const head = request.questions.click_target;
    if (!head) return;
    let annotated = false;
    for (const [id, value] of Object.entries(head.criteria)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const criterion = value as Record<string, unknown>;
      if (typeof criterion.href !== 'string') continue;
      // Browser snapshots already provide resolved absolute hrefs. Preserve
      // the exact query and fragment; do not infer that another view was read.
      const previous = this.destinations.get(criterion.href);
      if (!previous) continue;
      head.criteria[id] = { ...criterion, prior_observation: { ...previous } };
      annotated = true;
    }
    if (annotated) request.state.destinationObservationPolicy = POLICY;
  }
}
