import {
  logDrawerEntry,
  getDrawerBalance,
  getLatestDrawerEntry,
  type DrawerEntry
} from "@/database/cashDrawer"

/**
 * Open a new shift — logs an opening_balance entry.
 * The running balance is reset to the terminal's configured starting amount.
 */
export async function openDrawerShift(
  terminalId: string,
  merchantId: string,
  startingAmount: number
): Promise<DrawerEntry> {
  return logDrawerEntry({
    terminal_id: terminalId,
    merchant_id: merchantId,
    type: "opening_balance",
    amount: startingAmount,
    running_balance: startingAmount,
    notes: "Shift opened"
  })
}

/**
 * Log a completed cash sale.
 * The drawer balance increases by the sale total (what was charged).
 */
export async function logCashSale(
  terminalId: string,
  merchantId: string,
  saleTotal: number,
  cashTendered: number,
  changeGiven: number
): Promise<DrawerEntry> {
  const currentBalance = await getDrawerBalance(terminalId)
  const newBalance = currentBalance + saleTotal

  return logDrawerEntry({
    terminal_id: terminalId,
    merchant_id: merchantId,
    type: "cash_sale",
    amount: saleTotal,
    running_balance: newBalance,
    sale_total: saleTotal,
    cash_tendered: cashTendered,
    change_given: changeGiven
  })
}

/**
 * Close out the shift.
 * Logs a closeout entry with expected vs actual amounts.
 * Returns the discrepancy (positive = overage, negative = short).
 */
export async function closeDrawerShift(
  terminalId: string,
  merchantId: string,
  actualAmount: number
): Promise<{ entry: DrawerEntry; expectedBalance: number; discrepancy: number }> {
  const expectedBalance = await getDrawerBalance(terminalId)
  const discrepancy = actualAmount - expectedBalance

  const entry = await logDrawerEntry({
    terminal_id: terminalId,
    merchant_id: merchantId,
    type: "closeout",
    amount: actualAmount,
    running_balance: actualAmount,
    actual_amount: actualAmount,
    notes: `Closeout: expected $${expectedBalance.toFixed(2)}, counted $${actualAmount.toFixed(2)}, discrepancy $${discrepancy.toFixed(2)}`
  })

  return { entry, expectedBalance, discrepancy }
}

/**
 * Get current drawer state for a terminal — balance and last entry.
 */
export async function getDrawerState(terminalId: string): Promise<{
  balance: number
  lastEntry: DrawerEntry | null
}> {
  const [balance, lastEntry] = await Promise.all([
    getDrawerBalance(terminalId),
    getLatestDrawerEntry(terminalId)
  ])
  return { balance, lastEntry }
}
