/**
 * Obsolete automatic Lightning sweeps are intentionally disabled.
 * Merchant BTC remains in the active provider account and is surfaced through
 * the unified Bitcoin balance, so scheduled sweep processing must not move
 * funds into a second wallet representation.
 */
export function scheduleLightningSweepProcessing(trigger: string, options?: { limit?: number }): void {
  void trigger
  void options
}

export function resetLightningSweepMaintenanceLeaseForTests(): void {
  // Kept for compatibility with tests that reset maintenance state.
}
