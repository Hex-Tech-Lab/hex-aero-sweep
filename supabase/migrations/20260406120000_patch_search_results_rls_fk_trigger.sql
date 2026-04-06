-- Patch Migration: Fix RLS Security, FK Constraints, and Performance
-- Addresses CodeRabbit review findings

-- Fix 1: Add proper FK constraint with ON DELETE CASCADE
-- Drop the existing constraint if exists, then add correct one
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'search_results_job_id_fkey' 
    AND table_schema = 'airline'
  ) THEN
    ALTER TABLE airline.search_results DROP CONSTRAINT search_results_job_id_fkey;
  END IF;
END$$;

ALTER TABLE airline.search_results 
  ADD CONSTRAINT search_results_job_id_fkey 
  FOREIGN KEY (job_id) REFERENCES airline.search_jobs(id) ON DELETE CASCADE;

-- Fix 2: Remove overly restrictive UNIQUE constraint that prevents same-day alternatives
ALTER TABLE airline.search_results DROP CONSTRAINT IF EXISTS search_results_job_id_outbound_dep_nights_booking_class_out_key;

-- Fix 3: Replace permissive RLS policies with service-role only access
-- First, drop existing permissive policies
DROP POLICY IF EXISTS "Allow public insert on search_results" ON airline.search_results;
DROP POLICY IF EXISTS "Allow public update on search_results" ON airline.search_results;
DROP POLICY IF EXISTS "Allow public insert on price_calendar" ON airline.search_results;
DROP POLICY IF EXISTS "Allow public update on price_calendar" ON airline.price_calendar;

-- Create service-role only policies (frontend cannot insert/update directly)
-- These policies restrict access to service_role only
CREATE POLICY "Service role only insert on search_results"
  ON airline.search_results FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role only update on search_results"
  ON airline.search_results FOR UPDATE
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role only insert on price_calendar"
  ON airline.price_calendar FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role only update on price_calendar"
  ON airline.price_calendar FOR UPDATE
  USING (auth.role() = 'service_role');

-- Fix 4: Add BEFORE UPDATE trigger for price_calendar.updated_at
CREATE OR REPLACE FUNCTION airline.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_price_calendar_updated_at ON airline.price_calendar;
CREATE TRIGGER update_price_calendar_updated_at
  BEFORE UPDATE ON airline.price_calendar
  FOR EACH ROW
  EXECUTE FUNCTION airline.update_updated_at_column();
