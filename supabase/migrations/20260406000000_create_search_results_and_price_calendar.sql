-- Search Results and Price Calendar Tables
-- For persisting sweep results and price normalization

-- Create search_results table in airline schema
CREATE TABLE IF NOT EXISTS airline.search_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  outbound_flight text,
  inbound_flight text,
  outbound_dep date,
  inbound_dep date,
  nights integer NOT NULL,
  carrier_iata text NOT NULL,
  booking_class_out text DEFAULT 'Y',
  fare_family_name text,
  base_fare_eur numeric NOT NULL,
  taxes_eur numeric DEFAULT 0,
  total_raw_eur numeric NOT NULL,
  parity_total_penalty numeric DEFAULT 0,
  total_normalized_eur numeric NOT NULL,
  net_saving_eur numeric DEFAULT 0,
  is_saving boolean DEFAULT false,
  status text DEFAULT 'CANDIDATE',
  penalty_badge text,
  raw_offer jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(job_id, outbound_dep, nights, booking_class_out)
);

-- Create price_calendar table in airline schema
CREATE TABLE IF NOT EXISTS airline.price_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  outbound_date date NOT NULL,
  nights integer NOT NULL,
  cheapest_raw numeric NOT NULL,
  cheapest_normalized numeric NOT NULL,
  fare_family text,
  booking_class text,
  data_source text DEFAULT 'DUFFEL',
  confidence numeric,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(job_id, outbound_date, nights)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_search_results_job_id ON airline.search_results(job_id);
CREATE INDEX IF NOT EXISTS idx_search_results_carrier ON airline.search_results(carrier_iata);
CREATE INDEX IF NOT EXISTS idx_search_results_outbound ON airline.search_results(outbound_dep);
CREATE INDEX IF NOT EXISTS idx_price_calendar_job_id ON airline.price_calendar(job_id);
CREATE INDEX IF NOT EXISTS idx_price_calendar_date ON airline.price_calendar(outbound_date);

-- Enable RLS
ALTER TABLE airline.search_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE airline.price_calendar ENABLE ROW LEVEL SECURITY;

-- Permissive RLS policies
CREATE POLICY "Allow public read on search_results"
  ON airline.search_results FOR SELECT USING (true);

CREATE POLICY "Allow public insert on search_results"
  ON airline.search_results FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read on price_calendar"
  ON airline.price_calendar FOR SELECT USING (true);

CREATE POLICY "Allow public insert on price_calendar"
  ON airline.price_calendar FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update on price_calendar"
  ON airline.price_calendar FOR UPDATE USING (true);
