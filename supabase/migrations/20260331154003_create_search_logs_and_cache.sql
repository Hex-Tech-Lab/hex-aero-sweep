/*
  # Hex-Aero-Sweep Production Schema

  ## Overview
  Replaces previous schema with production-ready tables for search telemetry and API caching.

  ## New Tables

  ### `search_logs` (Transactional telemetry)
  Core sweep execution tracking with complete configuration and metrics
  - `id` (uuid, primary key) - Unique log identifier
  - `session_id` (text, indexed) - Unique session identifier for this sweep
  - `pnr` (text) - Passenger Name Record
  - `passengers_count` (integer) - Number of passengers
  - `fare_class` (text) - Booking class (ECONOMY, BUSINESS, FIRST)
  - `base_cost` (numeric) - Original ticket cost
  - `date_range_from` (date) - Search window start date
  - `date_range_to` (date) - Search window end date
  - `target_duration_min` (integer) - Minimum nights
  - `target_duration_max` (integer) - Maximum nights
  - `max_price_diff` (numeric) - Price tolerance threshold
  - `api_calls_used` (integer) - Total API calls made
  - `results_found` (integer) - Number of viable candidates
  - `status` (text) - Execution status: pending, in_progress, completed, error, aborted
  - `created_at` (timestamptz) - Record creation timestamp
  - `completed_at` (timestamptz) - Completion timestamp

  ### `duffel_cache` (API caching layer)
  Cached Duffel API responses to minimize redundant calls
  - `id` (uuid, primary key) - Unique cache entry
  - `search_hash` (text, unique indexed) - Hash key (e.g., "CAI-ATH-20260330-20260405-1pax")
  - `origin` (text) - Origin airport code
  - `destination` (text) - Destination airport code
  - `departure_date` (date) - Departure date
  - `return_date` (date) - Return date
  - `passengers_count` (integer) - Passenger count
  - `response_data` (jsonb) - Cached API response
  - `created_at` (timestamptz) - Cache creation timestamp
  - `expires_at` (timestamptz, indexed) - Cache expiration timestamp

  ## Security
  - RLS enabled on all tables
  - Public access policies (analyst tool without auth)

  ## Indexes
  - Performance indexes on session_id, search_hash, expires_at
*/

-- Drop old tables if they exist
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS flight_candidates CASCADE;
DROP TABLE IF EXISTS sweep_executions CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;

-- Create search_logs table
CREATE TABLE IF NOT EXISTS search_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  pnr text NOT NULL,
  passengers_count integer NOT NULL DEFAULT 1,
  fare_class text DEFAULT 'ECONOMY',
  base_cost numeric NOT NULL,
  date_range_from date NOT NULL,
  date_range_to date NOT NULL,
  target_duration_min integer NOT NULL DEFAULT 3,
  target_duration_max integer NOT NULL DEFAULT 14,
  max_price_diff numeric NOT NULL DEFAULT 50,
  api_calls_used integer DEFAULT 0,
  results_found integer DEFAULT 0,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Create duffel_cache table
CREATE TABLE IF NOT EXISTS duffel_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_hash text UNIQUE NOT NULL,
  origin text NOT NULL,
  destination text NOT NULL,
  departure_date date NOT NULL,
  return_date date NOT NULL,
  passengers_count integer NOT NULL DEFAULT 1,
  response_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_search_logs_session_id ON search_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_search_logs_status ON search_logs(status);
CREATE INDEX IF NOT EXISTS idx_search_logs_created_at ON search_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_duffel_cache_search_hash ON duffel_cache(search_hash);
CREATE INDEX IF NOT EXISTS idx_duffel_cache_expires_at ON duffel_cache(expires_at);

-- Enable Row Level Security
ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE duffel_cache ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Allow public read access to search_logs"
  ON search_logs FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert to search_logs"
  ON search_logs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public update to search_logs"
  ON search_logs FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public read access to duffel_cache"
  ON duffel_cache FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert to duffel_cache"
  ON duffel_cache FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public update to duffel_cache"
  ON duffel_cache FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete from duffel_cache"
  ON duffel_cache FOR DELETE
  USING (true);