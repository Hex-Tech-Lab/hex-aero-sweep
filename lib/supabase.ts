import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type SearchLog = {
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
};

export type DuffelCache = {
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
};
