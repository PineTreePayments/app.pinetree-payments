/**
 * PineTree Fee Calculation Module
 * 
 * Centralized fee calculation logic for the PineTree platform.
 * All fee-related calculations should use this module.
 */

import { PINETREE_FEE } from "./config"

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
  return merchantAmount + pinetreeFee
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
  return grossAmount - pinetreeFee
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
  return amount * (taxRate / 100)
}

/**
 * Calculate total with tax
 * 
 * @param amount - The pre-tax amount
 * @param taxRate - Tax rate as a percentage
 * @returns The total amount including tax
 */
export function calculateTotalWithTax(amount: number, taxRate: number): number {
  return amount + calculateTax(amount, taxRate)
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
  const subtotal = merchantAmount + tax
  const pinetreeFee = customFee
  const grossAmount = subtotal + pinetreeFee

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