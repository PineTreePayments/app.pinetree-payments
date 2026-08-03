/**
 * Shared Admin Transaction Detail presentation layer.
 *
 * Import from `@/components/admin/TransactionDetail` — never reach past this
 * barrel and never re-implement a transaction-detail modal elsewhere in Admin.
 */

export { default as AdminTransactionDetailPanel, adminSourcePillClass } from "./AdminTransactionDetailPanel"
export { useAdminTransactionDetail, type AdminTransactionDetailController } from "./useAdminTransactionDetail"
export {
  ADMIN_TRANSACTION_DETAIL_SECTION_DEFAULTS,
  type AdminTransactionDetail,
  type AdminTransactionDetailEvent,
  type AdminTransactionDetailMerchant,
  type AdminTransactionDetailPayment,
  type AdminTransactionDetailSections,
} from "./types"
export {
  adminPaymentReference,
  formatAdminDateTime,
  formatAdminMoney,
  formatAdminProvider,
} from "./format"
