import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  Ticket,
  SweepExecution,
  FlightCandidate,
  AuditLog,
  SearchJob,
  FareFamily,
  ResolveFareFamilyParams,
  ResolveFareFamilyResult,
  CreateSearchJobParams,
  CreateSearchJobResult,
  SearchLog,
  DuffelCache,
} from '@/types/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.SUPABASE_ANON_KEY || '';

let supabase: SupabaseClient;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("⚠️ Missing Supabase environment variables during build.");
  supabase = createClient('https://placeholder.supabase.co', 'placeholder-key');
} else {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

export { supabase };
export type {
  Ticket,
  SweepExecution,
  FlightCandidate,
  AuditLog,
  SearchJob,
  FareFamily,
  ResolveFareFamilyParams,
  ResolveFareFamilyResult,
  CreateSearchJobParams,
  CreateSearchJobResult,
  SearchLog,
  DuffelCache,
};

// Airline Schema RPC Functions
export async function resolveFareFamily(params: ResolveFareFamilyParams): Promise<ResolveFareFamilyResult | null> {
  try {
    // Use raw query to target airline schema for the RPC function
    const { data, error } = await supabase.rpc('resolve_fare_family', params);
    
    if (error) {
      console.error('[Supabase] resolve_fare_family error:', error);
      return null;
    }
    
    return data as ResolveFareFamilyResult;
  } catch (err) {
    console.error('[Supabase] resolve_fare_family exception:', err);
    return null;
  }
}

export async function createSearchJob(params: CreateSearchJobParams): Promise<CreateSearchJobResult | null> {
  try {
    const { data, error } = await supabase.rpc('create_search_job', params);
    
    if (error) {
      console.error('[Supabase] create_search_job error:', error);
      return null;
    }
    
    return data as CreateSearchJobResult;
  } catch (err) {
    console.error('[Supabase] create_search_job exception:', err);
    return null;
  }
}

export async function updateSearchJob(jobId: string, updates: Partial<SearchJob>): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('search_jobs')
      .update(updates)
      .eq('id', jobId);
    
    if (error) {
      console.error('[Supabase] update_search_job error:', error);
      return false;
    }
    
    return true;
  } catch (err) {
    console.error('[Supabase] update_search_job exception:', err);
    return false;
  }
}

// Public Schema Operations
export async function insertTicket(ticket: Omit<Ticket, 'id' | 'created_at' | 'updated_at'>): Promise<Ticket | null> {
  const { data, error } = await supabase
    .from('tickets')
    .insert([ticket])
    .select()
    .maybeSingle();
  
  if (error) {
    console.error('[Supabase] insertTicket error:', error);
    return null;
  }
  
  return data;
}

export async function insertSweepExecution(execution: Omit<SweepExecution, 'id' | 'created_at'>): Promise<SweepExecution | null> {
  const { data, error } = await supabase
    .from('sweep_executions')
    .insert([execution])
    .select()
    .maybeSingle();
  
  if (error) {
    console.error('[Supabase] insertSweepExecution error:', error);
    return null;
  }
  
  return data;
}

export async function updateSweepExecution(executionId: string, updates: Partial<SweepExecution>): Promise<boolean> {
  const { error } = await supabase
    .from('sweep_executions')
    .update(updates)
    .eq('id', executionId);
  
  if (error) {
    console.error('[Supabase] updateSweepExecution error:', error);
    return false;
  }
  
  return true;
}

export async function insertFlightCandidate(candidate: Omit<FlightCandidate, 'id' | 'created_at'>): Promise<FlightCandidate | null> {
  const { data, error } = await supabase
    .from('flight_candidates')
    .insert([candidate])
    .select()
    .maybeSingle();
  
  if (error) {
    console.error('[Supabase] insertFlightCandidate error:', error);
    return null;
  }
  
  return data;
}

export async function insertAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>): Promise<boolean> {
  const { error } = await supabase
    .from('audit_logs')
    .insert([log]);
  
  if (error) {
    console.error('[Supabase] insertAuditLog error:', error);
    return false;
  }
  
  return true;
}

// Legacy operations for backwards compatibility
export async function createSearchLog(log: Omit<SearchLog, 'id' | 'created_at' | 'completed_at'>) {
  const { data, error } = await supabase
    .from('search_logs')
    .insert([{ ...log, completed_at: null }])
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data;
}

export async function updateSearchLog(sessionId: string, updates: Partial<SearchLog>) {
  const { data, error } = await supabase
    .from('search_logs')
    .update(updates)
    .eq('session_id', sessionId)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data;
}

export async function getCachedSearch(searchHash: string) {
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('duffel_cache')
    .select('*')
    .eq('search_hash', searchHash)
    .gt('expires_at', now)
    .maybeSingle();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function saveCacheEntry(cache: Omit<DuffelCache, 'id' | 'created_at'>) {
  const { data, error } = await supabase
    .from('duffel_cache')
    .insert([cache])
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data;
}

export async function getSearchHistory(limit: number = 50, offset: number = 0) {
  const { data, error } = await supabase
    .from('search_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  
  if (error) throw error;
  return data;
}
