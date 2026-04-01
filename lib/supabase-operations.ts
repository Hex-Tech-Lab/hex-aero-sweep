import { supabase, SearchLog, DuffelCache } from '@/lib/supabase';

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

export async function getSearchLog(sessionId: string) {
  const { data, error } = await supabase
    .from('search_logs')
    .select('*')
    .eq('session_id', sessionId)
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

export async function cleanExpiredCache() {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('duffel_cache')
    .delete()
    .lt('expires_at', now);

  if (error) throw error;
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
