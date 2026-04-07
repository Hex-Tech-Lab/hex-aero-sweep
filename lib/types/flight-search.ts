export interface ProbeArm {
  arm: number;
  outbound_date: string;
  season_tag: string;
  ucb1_weight: number;
}

export interface Passenger {
  type: 'adult' | 'child';
  age?: number;
}

export interface DuffelQuery {
  from: string;
  to: string;
  departure_date: string;
  return_date: string;
  passengers: Passenger[];
  cabin_class: 'economy' | 'business' | 'first';
  filters?: {
    airlines?: string[];
    stops?: number;
  };
}

import type { TierRank } from '../constants/rebooking-budget';

export interface ExploitResult {
  arm: number;
  outbound_date: string;
  return_date: string;
  total_price_usd: number;
  net_cost: number;
  percent_overage: number;
  tier: TierRank;
  flights: {
    outbound_flight_id: string;
    return_flight_id: string;
  };
}

export interface ExploitBatchResult {
  arm: number;
  queries: ExploitResult[];
  topCandidate: ExploitResult | null;
}
