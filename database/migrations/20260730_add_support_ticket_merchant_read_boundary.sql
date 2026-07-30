-- Merchant unread support-message notifications.
--
-- Read state is stored as a per-ticket timestamp boundary on `support_tickets`
-- rather than a new receipt table: PineTree's tenant model resolves
-- `merchant_id` directly from the authenticated Supabase user
-- (lib/api/merchantAuth.ts -> requireMerchantAuthFromRequest), so there is no
-- multi-member merchant staff model that would require per-user receipts today.
-- If merchant staff members are introduced later, this column becomes the
-- account-wide default and a normalized receipt table can be layered on top
-- without a data migration.
--
-- Unread = COUNT(support_ticket_messages) for the ticket where
--   sender_type = 'pinetree' AND created_at > COALESCE(merchant_last_read_at, '-infinity')
-- Merchant messages and 'system' entries never count as merchant unread.

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS merchant_last_read_at TIMESTAMPTZ;

COMMENT ON COLUMN support_tickets.merchant_last_read_at IS
  'Timestamp boundary of the newest support message this merchant has viewed. Advanced only by POST /api/support/tickets/:ticketId/read, and only forward.';

-- Unread counting reads support messages by merchant + sender + recency.
CREATE INDEX IF NOT EXISTS support_ticket_messages_merchant_sender_created_idx
  ON support_ticket_messages (merchant_id, sender_type, created_at DESC);

CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_created_idx
  ON support_ticket_messages (ticket_id, created_at DESC);

-- ─── Cross-tenant isolation (apply deliberately) ────────────────────────────
-- Support reads/writes in this repository run exclusively through server
-- routes that resolve merchant_id from the verified session and use the
-- service-role client (database/supportTickets.ts, database/adminSupport.ts).
-- Nothing in the browser queries these tables directly.
--
-- The statements below add defence-in-depth for direct PostgREST access. They
-- are intentionally NOT executed by default: database/supportTickets.ts falls
-- back to the anon client when SUPABASE_SERVICE_ROLE_KEY is absent, and
-- enabling RLS without that key present would break support in that
-- environment. Verify the service-role key is configured, then run:
--
--   ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;
--
--   CREATE POLICY support_tickets_owner_read ON support_tickets
--     FOR SELECT USING (auth.uid() = merchant_id);
--
--   CREATE POLICY support_ticket_messages_owner_read ON support_ticket_messages
--     FOR SELECT USING (auth.uid() = merchant_id);
--
-- The service-role key bypasses RLS, so server routes keep working unchanged.
