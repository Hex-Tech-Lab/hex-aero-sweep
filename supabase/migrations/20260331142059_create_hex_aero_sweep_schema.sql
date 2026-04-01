/*
  # Hex-Aero-Sweep Database Schema
  
  ## Overview
  Complete database schema for aviation pricing intelligence platform supporting
  ticket ingestion, sweep execution tracking, flight candidate storage, and audit logging.
  
  ## New Tables
  
  ### `tickets`
  Stores parsed aviation ticket data from PDF or manual entry
  - `id` (uuid, primary key) - Unique ticket identifier
  - `pnr` (text, indexed) - Passenger Name Record code (6-character alphanumeric)
  - `last_name` (text) - Passenger last name
  - `passengers` (integer) - Number of passengers on booking
  - `fare_class` (text) - Booking fare class (Economy, Business, First)
  - `base_cost` (numeric) - Original ticket cost in USD
  - `issue_date` (date) - Date ticket was issued
  - `expiration_date` (date, indexed) - Calculated expiration (issue_date + 1 year)
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp
  
  ### `sweep_executions`
  Tracks each pricing sweep execution with configuration and status
  - `id` (uuid, primary key) - Unique execution identifier
  - `ticket_id` (uuid, foreign key) - Reference to tickets table
  - `search_window_start` (date) - Start of search date range
  - `search_window_end` (date) - End of search date range  
  - `min_nights` (integer) - Minimum trip duration in nights
  - `max_nights` (integer) - Maximum trip duration in nights
  - `price_tolerance` (numeric) - Maximum acceptable price delta from base cost
  - `max_api_calls` (integer) - Circuit breaker limit for API requests
  - `status` (text) - Execution status: pending, running, completed, error, aborted
  - `total_scanned` (integer) - Total combinations evaluated
  - `candidates_found` (integer) - Number of viable flights found
  - `out_of_range` (integer) - Number of flights exceeding price tolerance
  - `started_at` (timestamptz) - Execution start time
  - `completed_at` (timestamptz) - Execution completion time
  - `created_at` (timestamptz) - Record creation timestamp
  
  ### `flight_candidates`
  Stores individual flight search results meeting criteria
  - `id` (uuid, primary key) - Unique candidate identifier
  - `sweep_execution_id` (uuid, foreign key) - Reference to sweep_executions
  - `carrier` (text, indexed) - Airline carrier code (e.g., A3, DL, UA)
  - `departure_date` (date, indexed) - Outbound flight date
  - `return_date` (date) - Return flight date
  - `nights` (integer) - Trip duration in nights
  - `price` (numeric) - Total price in USD
  - `yield_delta` (numeric) - Price difference from base cost (negative = savings)
  - `status` (text) - Candidate status: anchor, dom, expansion, rejected
  - `metadata_json` (jsonb) - Additional flight details (segments, layovers, booking class)
  - `created_at` (timestamptz) - Record creation timestamp
  
  ### `audit_logs`
  Comprehensive audit trail of sweep execution logs
  - `id` (uuid, primary key) - Unique log identifier
  - `sweep_execution_id` (uuid, foreign key) - Reference to sweep_executions
  - `log_level` (text) - Log severity: info, success, warning, error
  - `message` (text) - Log message content
  - `timestamp` (timestamptz, indexed) - Log entry timestamp
  
  ## Security
  - RLS enabled on all tables
  - Public access policies for read/write (suitable for analyst tool without auth)
  - Can be restricted later if authentication added
  
  ## Indexes
  - Performance indexes on frequently queried columns
  - Foreign key indexes for join optimization
  - Composite indexes for common query patterns
*/

-- Create tickets table
CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pnr text NOT NULL,
  last_name text NOT NULL,
  passengers integer NOT NULL DEFAULT 1,
  fare_class text DEFAULT 'ECONOMY',
  base_cost numeric NOT NULL,
  issue_date date NOT NULL,
  expiration_date date NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create sweep_executions table
CREATE TABLE IF NOT EXISTS sweep_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
  search_window_start date NOT NULL,
  search_window_end date NOT NULL,
  min_nights integer NOT NULL DEFAULT 3,
  max_nights integer NOT NULL DEFAULT 14,
  price_tolerance numeric NOT NULL DEFAULT 50,
  max_api_calls integer NOT NULL DEFAULT 100,
  status text DEFAULT 'pending',
  total_scanned integer DEFAULT 0,
  candidates_found integer DEFAULT 0,
  out_of_range integer DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create flight_candidates table
CREATE TABLE IF NOT EXISTS flight_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_execution_id uuid REFERENCES sweep_executions(id) ON DELETE CASCADE,
  carrier text NOT NULL,
  departure_date date NOT NULL,
  return_date date NOT NULL,
  nights integer NOT NULL,
  price numeric NOT NULL,
  yield_delta numeric NOT NULL,
  status text DEFAULT 'candidate',
  metadata_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_execution_id uuid REFERENCES sweep_executions(id) ON DELETE CASCADE,
  log_level text NOT NULL,
  message text NOT NULL,
  timestamp timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tickets_pnr ON tickets(pnr);
CREATE INDEX IF NOT EXISTS idx_tickets_expiration ON tickets(expiration_date);
CREATE INDEX IF NOT EXISTS idx_sweep_executions_ticket_id ON sweep_executions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_sweep_executions_status ON sweep_executions(status);
CREATE INDEX IF NOT EXISTS idx_flight_candidates_sweep_id ON flight_candidates(sweep_execution_id);
CREATE INDEX IF NOT EXISTS idx_flight_candidates_carrier ON flight_candidates(carrier);
CREATE INDEX IF NOT EXISTS idx_flight_candidates_departure ON flight_candidates(departure_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_sweep_id ON audit_logs(sweep_execution_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);

-- Enable Row Level Security
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sweep_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flight_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (permissive for analyst tool - can be restricted later)
CREATE POLICY "Allow public read access to tickets"
  ON tickets FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert to tickets"
  ON tickets FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public update to tickets"
  ON tickets FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public read access to sweep_executions"
  ON sweep_executions FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert to sweep_executions"
  ON sweep_executions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public update to sweep_executions"
  ON sweep_executions FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public read access to flight_candidates"
  ON flight_candidates FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert to flight_candidates"
  ON flight_candidates FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public read access to audit_logs"
  ON audit_logs FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert to audit_logs"
  ON audit_logs FOR INSERT
  WITH CHECK (true);