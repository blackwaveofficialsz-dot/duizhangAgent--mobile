import type { LaborTrendPoint } from '@/services/api/analytics';

export const MIN_LEGACY_LABOR_COMPLETENESS_RATIO = 0.2;

export const LABOR_COMPLETENESS_STATUS = {
  filtered: 'filtered',
  missing: 'missing',
  visible: 'visible',
} as const;

export type LaborCompletenessStatus = typeof LABOR_COMPLETENESS_STATUS[keyof typeof LABOR_COMPLETENESS_STATUS];

type CompletenessPoint = Pick<LaborTrendPoint, 'actual_hours' | 'hours_synced' | 'missing' | 'planned_hours'>;

export function laborCompletenessStatus(point: CompletenessPoint): LaborCompletenessStatus {
  if (point.missing) return LABOR_COMPLETENESS_STATUS.missing;
  if (point.planned_hours > 0) return point.actual_hours / point.planned_hours >= MIN_LEGACY_LABOR_COMPLETENESS_RATIO
    ? LABOR_COMPLETENESS_STATUS.visible
    : LABOR_COMPLETENESS_STATUS.filtered;
  if (typeof point.hours_synced === 'boolean') return point.hours_synced
    ? LABOR_COMPLETENESS_STATUS.visible
    : LABOR_COMPLETENESS_STATUS.filtered;
  return LABOR_COMPLETENESS_STATUS.visible;
}
