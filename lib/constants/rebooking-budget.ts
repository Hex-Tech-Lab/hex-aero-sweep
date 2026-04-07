export const REBOOKING_BUDGET = {
  original_pnr_cost: 792.87,
  strict_tolerance_usd: 70,
  soft_tolerance_usd: 100,
  strict_tolerance_pct: 8.8,
  soft_tolerance_pct: 12.6,
  deadline_date: '2026-09-02',
} as const;

export type TierRank = 'TIER_1_STRICT' | 'TIER_2_SOFT' | 'TIER_3_LAST_RESORT';

export function assignTier(netCost: number): TierRank {
  if (netCost <= REBOOKING_BUDGET.strict_tolerance_usd) return 'TIER_1_STRICT';
  if (netCost <= REBOOKING_BUDGET.soft_tolerance_usd) return 'TIER_2_SOFT';
  return 'TIER_3_LAST_RESORT';
}
