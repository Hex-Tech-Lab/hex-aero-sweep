export interface FareFamilyRow {
  fare_family_id: string;
  fare_family_name: string;
  parity_tier: number;
  change_pre_fee_eur: number | null;
  change_post_fee_eur: number | null;
  cancel_fee_eur: number | null;
  refund_full: boolean;
  checked_pieces: number;
}

export type FareFamilyCache = Map<string, FareFamilyRow>;

export interface ComputeParityPenaltyParams {
  p_original_family_id: string;
  p_candidate_family_id: string;
  p_passenger_adults?: number;
  p_passenger_children?: number;
}

export interface SearchResultRow {
  job_id: string;
  outbound_flight: string;
  inbound_flight: string;
  outbound_dep: string;
  inbound_dep: string;
  nights: number;
  carrier_iata: string;
  booking_class_out: string;
  fare_family_name: string;
  base_fare_eur: number;
  taxes_eur: number;
  total_raw_eur: number;
  parity_total_penalty: number;
  total_normalized_eur: number;
  net_saving_eur: number;
  is_saving: boolean;
  status: string;
  penalty_badge: string | null;
  raw_offer: Record<string, any> | null;
}

export interface PriceCalendarRow {
  job_id: string;
  outbound_date: string;
  nights: number;
  cheapest_raw: number;
  cheapest_normalized: number;
  fare_family: string;
  booking_class: string;
  data_source: 'CACHE' | 'DUFFEL';
  confidence: number | null;
}
