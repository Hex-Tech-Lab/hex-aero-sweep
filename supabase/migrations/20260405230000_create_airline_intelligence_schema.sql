-- Airline Intelligence Schema v4.0
-- Dual-schema architecture for aviation pricing intelligence

-- Create airline schema
CREATE SCHEMA IF NOT EXISTS airline;

-- Fare Families table: Stores fare family definitions per carrier
CREATE TABLE IF NOT EXISTS airline.fare_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_iata text NOT NULL,
  fare_class text NOT NULL,
  fare_family_name text NOT NULL,
  parity_tier integer NOT NULL DEFAULT 2,
  base_fare_usd numeric,
  change_fee_domestic numeric DEFAULT 0,
  change_fee_international numeric DEFAULT 0,
  cancellation_fee numeric DEFAULT 0,
  checked_bag_allowance integer DEFAULT 1,
  cabin text DEFAULT 'economy',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(carrier_iata, fare_class)
);

-- Search Jobs table: Tracks each pricing sweep job with fare family context
CREATE TABLE IF NOT EXISTS airline.search_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid,
  sweep_execution_id uuid,
  pnr text NOT NULL,
  carrier_iata text NOT NULL,
  fare_class text NOT NULL,
  original_fare_family_id uuid REFERENCES airline.fare_families(id),
  parity_tier integer,
  anchor_base_cost numeric NOT NULL,
  search_window_start date NOT NULL,
  search_window_end date NOT NULL,
  min_nights integer NOT NULL DEFAULT 3,
  max_nights integer NOT NULL DEFAULT 14,
  price_tolerance numeric NOT NULL DEFAULT 50,
  max_api_calls integer NOT NULL DEFAULT 100,
  status text DEFAULT 'pending',
  total_scanned integer DEFAULT 0,
  candidates_found integer DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_fare_families_carrier ON airline.fare_families(carrier_iata);
CREATE INDEX IF NOT EXISTS idx_search_jobs_status ON airline.search_jobs(status);
CREATE INDEX IF NOT EXISTS idx_search_jobs_created ON airline.search_jobs(created_at DESC);

-- Enable RLS on airline schema tables
ALTER TABLE airline.fare_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE airline.search_jobs ENABLE ROW LEVEL SECURITY;

-- Permissive RLS policies for airline schema (analyst tool)
CREATE POLICY "Allow public read on fare_families"
  ON airline.fare_families FOR SELECT USING (true);

CREATE POLICY "Allow public insert on fare_families"
  ON airline.fare_families FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read on search_jobs"
  ON airline.search_jobs FOR SELECT USING (true);

CREATE POLICY "Allow public insert on search_jobs"
  ON airline.search_jobs FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update on search_jobs"
  ON airline.search_jobs FOR UPDATE USING (true);

-- RPC: resolve_fare_family
-- Resolves booking class to fare family with parity tier for apples-to-apples comparison
CREATE OR REPLACE FUNCTION airline.resolve_fare_family(
  p_carrier_iata text,
  p_booking_class text,
  p_origin_iata text,
  p_dest_iata text
)
RETURNS TABLE (
  fare_family_id uuid,
  fare_family_name text,
  parity_tier integer,
  base_fare_usd numeric,
  is_domestic boolean,
  cabin text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fare_family airline.fare_families%ROWTYPE;
  v_is_domestic boolean;
BEGIN
  -- Determine if route is domestic (Egypt: CAI-SSD, Greece: ATH-JTR)
  v_is_domestic := SUBSTRING(p_origin_iata, 1, 2) = SUBSTRING(p_dest_iata, 1, 2);

  -- Find fare family by carrier and booking class
  SELECT * INTO v_fare_family
  FROM airline.fare_families
  WHERE carrier_iata = p_carrier_iata
    AND fare_class ILIKE p_booking_class || '%'
    AND is_active = true
  ORDER BY CHAR_LENGTH(fare_class) ASC
  LIMIT 1;

  -- If no exact match, try generic class lookup
  IF NOT FOUND THEN
    SELECT * INTO v_fare_family
    FROM airline.fare_families
    WHERE carrier_iata = p_carrier_iata
      AND (fare_class ILIKE 'Y%' OR fare_class = 'ECONOMY')
      AND is_active = true
    LIMIT 1;
  END IF;

  -- Return result
  IF FOUND THEN
    RETURN QUERY SELECT
      v_fare_family.id,
      v_fare_family.fare_family_name,
      v_fare_family.parity_tier,
      v_fare_family.base_fare_usd,
      v_is_domestic,
      v_fare_family.cabin;
  ELSE
    -- Return default values if no fare family found
    RETURN QUERY SELECT
      NULL::uuid,
      'Standard Economy'::text,
      2::integer,
      NULL::numeric,
      v_is_domestic,
      'economy'::text;
  END IF;
END;
$$;

-- RPC: create_search_job
-- Creates a new search job with fare family anchor
CREATE OR REPLACE FUNCTION airline.create_search_job(
  p_ticket_id uuid,
  p_pnr text,
  p_carrier_iata text,
  p_booking_class text,
  p_fare_family_id uuid,
  p_parity_tier integer,
  p_anchor_base_cost numeric,
  p_search_window_start date,
  p_search_window_end date,
  p_min_nights integer,
  p_max_nights integer,
  p_price_tolerance numeric,
  p_max_api_calls integer
)
RETURNS TABLE (
  id uuid,
  sweep_execution_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id uuid;
  v_sweep_exec_id uuid;
BEGIN
  -- Create search job record
  INSERT INTO airline.search_jobs (
    ticket_id,
    pnr,
    carrier_iata,
    fare_class,
    original_fare_family_id,
    parity_tier,
    anchor_base_cost,
    search_window_start,
    search_window_end,
    min_nights,
    max_nights,
    price_tolerance,
    max_api_calls,
    status,
    started_at
  ) VALUES (
    p_ticket_id,
    p_pnr,
    p_carrier_iata,
    p_booking_class,
    p_fare_family_id,
    p_parity_tier,
    p_anchor_base_cost,
    p_search_window_start,
    p_search_window_end,
    p_min_nights,
    p_max_nights,
    p_price_tolerance,
    p_max_api_calls,
    'running',
    now()
  )
  RETURNING id INTO v_job_id;

  -- Also create sweep execution in public schema (if exists)
  INSERT INTO public.sweep_executions (
    ticket_id,
    search_window_start,
    search_window_end,
    min_nights,
    max_nights,
    price_tolerance,
    max_api_calls,
    status,
    started_at
  ) VALUES (
    p_ticket_id,
    p_search_window_start,
    p_search_window_end,
    p_min_nights,
    p_max_nights,
    p_price_tolerance,
    p_max_api_calls,
    'running',
    now()
  )
  RETURNING id INTO v_sweep_exec_id;

  RETURN QUERY SELECT v_job_id, v_sweep_exec_id;
END;
$$;

-- Seed default fare families for Aegean Airlines (A3)
INSERT INTO airline.fare_families (carrier_iata, fare_class, fare_family_name, parity_tier, base_fare_usd, cabin)
VALUES
  ('A3', 'Y', 'Flex Economy', 3, NULL, 'economy'),
  ('A3', 'B', 'Flex Economy', 3, NULL, 'economy'),
  ('A3', 'M', 'Classic Economy', 2, NULL, 'economy'),
  ('A3', 'H', 'Classic Economy', 2, NULL, 'economy'),
  ('A3', 'K', 'Light Economy', 1, NULL, 'economy'),
  ('A3', 'Q', 'Light Economy', 1, NULL, 'economy'),
  ('A3', 'V', 'Light Economy', 1, NULL, 'economy'),
  ('A3', 'L', 'Light Economy', 1, NULL, 'economy'),
  ('A3', 'U', 'Light Economy', 1, NULL, 'economy'),
  ('A3', 'T', 'Light Economy', 1, NULL, 'economy'),
  ('A3', 'X', 'Basic Economy', 0, NULL, 'economy'),
ON CONFLICT (carrier_iata, fare_class) DO NOTHING;
