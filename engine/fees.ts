/**
 * PineTree Fee Calculation Module
 * 
 * Centralized fee calculation logic for the PineTree platform.
 * All fee-related calculations should use this module.
 */

import { PINETREE_FEE } from "./config"

/**
 * Rounds a USD amount to the currency's minor unit (cents). Every monetary
 * value in this module passes through here before being returned - plain
 * float addition/multiplication (e.g. 19.99 * 0.0825) routinely produces
 * IEEE-754 artifacts with 15+ significant digits (21.789174999999997), which
 * Speed's POST /payments rejects outright ("Invalid amount. Integers and
 * fractions can have up to 16 digits value only.") - a real production 400
 * traced to this exact cause on a tax-enabled Bitcoin Lightning payment. Every
 * downstream rail (not just Speed) should only ever see cents-precise amounts
 * regardless of provider strictness, since fractional-cent values are never
 * meaningful for USD.
 */
function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100
}

/**
 * Calculate the gross amount (total customer pays)
 *
 * @param merchantAmount - The amount the merchant should receive
 * @param pinetreeFee - Optional custom fee (defaults to PINETREE_FEE)
 * @returns The total amount customer should pay
 */
export function calculateGrossAmount(
  merchantAmount: number,
  pinetreeFee: number = PINETREE_FEE
): number {
  return roundToCents(merchantAmount + pinetreeFee)
}

/**
 * Calculate the merchant amount from gross amount
 *
 * @param grossAmount - The total amount customer pays
 * @param pinetreeFee - Optional custom fee (defaults to PINETREE_FEE)
 * @returns The amount merchant will receive
 */
export function calculateMerchantAmount(
  grossAmount: number,
  pinetreeFee: number = PINETREE_FEE
): number {
  return roundToCents(grossAmount - pinetreeFee)
}

/**
 * Calculate tax amount
 *
 * @param amount - The pre-tax amount
 * @param taxRate - Tax rate as a percentage (e.g., 8.25 for 8.25%)
 * @returns The tax amount
 */
export function calculateTax(amount: number, taxRate: number): number {
  if (taxRate <= 0) return 0
  return roundToCents(amount * (taxRate / 100))
}

/**
 * Calculate total with tax
 *
 * @param amount - The pre-tax amount
 * @param taxRate - Tax rate as a percentage
 * @returns The total amount including tax
 */
export function calculateTotalWithTax(amount: number, taxRate: number): number {
  return roundToCents(amount + calculateTax(amount, taxRate))
}

/**
 * Calculate fee breakdown for a payment
 *
 * @param merchantAmount - The amount merchant should receive
 * @param taxRate - Optional tax rate
 * @param customFee - Optional custom PineTree fee
 * @returns Object with all fee components
 */
export function calculateFeeBreakdown(
  merchantAmount: number,
  taxRate: number = 0,
  customFee: number = PINETREE_FEE
) {
  const tax = calculateTax(merchantAmount, taxRate)
  const subtotal = roundToCents(merchantAmount + tax)
  const pinetreeFee = customFee
  const grossAmount = roundToCents(subtotal + pinetreeFee)

  return {
    merchantAmount,
    tax,
    subtotal,
    pinetreeFee,
    grossAmount
  }
}

/**
 * Format amount for display
 * 
 * @param amount - Amount in dollars
 * @param currency - Currency code (default: USD)
 * @returns Formatted string
 */
export function formatAmount(amount: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(amount)
}

/**
 * Parse amount from string input
 * 
 * @param input - String input (e.g., "10.50")
 * @returns Parsed number or NaN if invalid
 */
export function parseAmount(input: string | number): number {
  const num = Number(input)
  return isNaN(num) ? 0 : Math.round(num * 100) / 100
}

/**
 * Validate that an amount is valid
 * 
 * @param amount - Amount to validate
 * @returns True if valid, false otherwise
 */
export function isValidAmount(amount: number): boolean {
  return !isNaN(amount) && amount > 0 && isFinite(amount)
}