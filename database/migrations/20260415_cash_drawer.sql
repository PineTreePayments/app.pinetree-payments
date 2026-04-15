-- Add configurable starting cash amount to terminals
ALTER TABLE terminals
  ADD COLUMN IF NOT EXISTS drawer_starting_amount numeric(10,2) DEFAULT 0;

-- Cash drawer log: tracks every cash event (opening balance, sales, closeouts)
CREATE TABLE IF NOT EXISTS cash_drawer_log (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  terminal_id     uuid REFERENCES terminals(id) ON DELETE CASCADE NOT NULL,
  merchant_id     uuid NOT NULL,
  type            text NOT NULL CHECK (type IN ('opening_balance', 'cash_sale', 'closeout')),
  amount          numeric(10,2) NOT NULL DEFAULT 0,    -- net effect on drawer balance
  running_balance numeric(10,2) NOT NULL DEFAULT 0,    -- drawer balance after this entry
  sale_total      numeric(10,2),                       -- cash_sale: amount charged to customer
  cash_tendered   numeric(10,2),                       -- cash_sale: amount customer handed over
  change_given    numeric(10,2),                       -- cash_sale: change returned to customer
  actual_amount   numeric(10,2),                       -- closeout: amount cashier physically counted
  notes           text,
  created_at      timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS cash_drawer_log_terminal_created_idx
  ON cash_drawer_log(terminal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cash_drawer_log_merchant_created_idx
  ON cash_drawer_log(merchant_id, created_at DESC);
