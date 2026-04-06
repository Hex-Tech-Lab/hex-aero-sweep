// Supabase Database Types - Dual Schema (Public + Airline Intelligence)

export interface Ticket {
  id: string;
  pnr: string;
  last_name: string;
  passengers: number;
  fare_class: string;
  base_cost: number;
  issue_date: string;
  expiration_date: string;
  created_at: string;
  updated_at: string;
}

export interface SweepExecution {
  id: string;
  ticket_id: string | null;
  search_window_start: string;
  search_window_end: string;
  min_nights: number;
  max_nights: number;
  price_tolerance: number;
  max_api_calls: number;
  status: 'pending' | 'running' | 'completed' | 'error' | 'aborted';
  total_scanned: number;
  candidates_found: number;
  out_of_range: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface FlightCandidate {
  id: string;
  sweep_execution_id: string;
  carrier: string;
  departure_date: string;
  return_date: string;
  nights: number;
  price: number;
  yield_delta: number;
  status: string;
  metadata_json: Record<string, any>;
  created_at: string;
}

export interface AuditLog {
  id: string;
  sweep_execution_id: string;
  log_level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

// Airline Intelligence Schema Types

export interface FareFamily {
  id: string;
  carrier_iata: string;
  fare_class: string;
  fare_family_name: string;
  parity_tier: number;
  base_fare_usd: number;
  change_fee_domestic: number;
  change_fee_international: number;
  cancellation_fee: number;
  checked_bag_allowance: number;
  cabin: string;
  created_at: string;
}

export interface SearchJob {
  id: string;
  ticket_id: string;
  sweep_execution_id: string | null;
  pnr: string;
  carrier_iata: string;
  fare_class: string;
  original_fare_family_id: string | null;
  parity_tier: number | null;
  anchor_base_cost: number;
  search_window_start: string;
  search_window_end: string;
  min_nights: number;
  max_nights: number;
  price_tolerance: number;
  max_api_calls: number;
  status: 'pending' | 'running' | 'completed' | 'error' | 'aborted';
  total_scanned: number;
  candidates_found: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// RPC Function Return Types

export interface ResolveFareFamilyParams {
  p_carrier_iata: string;
  p_booking_class: string;
  p_origin_iata: string;
  p_dest_iata: string;
}

export interface ResolveFareFamilyResult {
  fare_family_id: string;
  fare_family_name: string;
  parity_tier: number;
  base_fare_usd: number;
  is_domestic: boolean;
  cabin: string;
}

export interface CreateSearchJobParams {
  p_ticket_id?: string | null;
  p_pnr?: string | null;
  p_carrier_iata: string;
  p_booking_class: string;
  p_fare_family_id?: string | null;
  p_parity_tier?: number | null;
  p_anchor_base_cost: number;
  p_search_window_start: string;
  p_search_window_end: string;
  p_min_nights: number;
  p_max_nights: number;
  p_price_tolerance: number;
  p_max_api_calls: number;
  p_origin_iata?: string;
  p_dest_iata?: string;
}

export interface CreateSearchJobResult {
  id: string;
  sweep_execution_id: string;
}

// Legacy types for backwards compatibility
export interface SearchLog {
  id: string;
  session_id: string;
  pnr: string;
  passengers_count: number;
  fare_class: string;
  base_cost: number;
  date_range_from: string;
  date_range_to: string;
  target_duration_min: number;
  target_duration_max: number;
  max_price_diff: number;
  api_calls_used: number;
  results_found: number;
  status: 'pending' | 'in_progress' | 'completed' | 'error' | 'aborted';
  created_at: string;
  completed_at: string | null;
}

export interface DuffelCache {
  id: string;
  search_hash: string;
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string;
  passengers_count: number;
  response_data: Record<string, any>;
  created_at: string;
  expires_at: string;
}
