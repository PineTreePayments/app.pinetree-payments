import { isBaseDelegatedEoaEnabled, isBaseV5Configured } from "./config"

/**
 * Base payment execution strategy types.
 *
 * USDC strategy order (highest priority first):
 *   1. delegated_eoa_batch   — wallet_sendCalls [approve + payUsdcWithAllowance] in one approval
 *   2. eip3009_relayer       — customer signs EIP-3009; PineTree relayer submits payUsdcWithAuthorization
 *   3. allowance_direct      — existing sufficient allowance; customer sends payUsdcWithAllowance
 *   4. allowance_two_step    — customer approves USDC then sends payUsdcWithAllowance
 *
 * ETH strategy:
 *   split_eth — customer sends ETH to V5.splitEth()
 *
 * Rules that apply to every strategy:
 *   - Only the final included V5 transaction hash is sent to /detect.
 *   - call id / batch id / operation id is never treated as a txHash.
 *   - approve-only txHash is never sent to /detect.
 *   - Watcher / eventProcessor / database remain the payment source of truth.
 */

export type BaseUsdcExecutionStrategy =
  | "delegated_eoa_batch"
  | "eip3009_relayer"
  | "allowance_direct"
  | "allowance_two_step"

export type BaseEthExecutionStrategy = "split_eth"

export type BaseUsdcStrategyCapabilities = {
  /** wallet_sendCalls [approve, payUsdcWithAllowance] — requires PINETREE_BASE_DELEGATED_EOA_ENABLED=true */
  delegatedEoaBatch: boolean
  /** PineTree relayer submits payUsdcWithAuthorization — requires relayer config */
  eip3009Relayer: boolean
  /** payUsdcWithAllowance when allowance already sufficient */
  allowanceDirect: true
  /** approve then payUsdcWithAllowance — always available as final fallback */
  allowanceTwoStep: true
}

export function getBaseUsdcStrategyCapabilities(): BaseUsdcStrategyCapabilities {
  return {
    delegatedEoaBatch: isBaseDelegatedEoaEnabled(),
    eip3009Relayer: isBaseV5Configured(),
    allowanceDirect: true,
    allowanceTwoStep: true,
  }
}

/**
 * Returns the ordered list of USDC strategies to attempt for this server instance.
 * The UI tries them in order, falling back on wallet rejection or capability mismatch.
 */
export function getBaseUsdcStrategyOrder(): BaseUsdcExecutionStrategy[] {
  const caps = getBaseUsdcStrategyCapabilities()
  const strategies: BaseUsdcExecutionStrategy[] = []

  if (caps.delegatedEoaBatch) strategies.push("delegated_eoa_batch")
  if (caps.eip3009Relayer) strategies.push("eip3009_relayer")

  strategies.push("allowance_direct", "allowance_two_step")

  return strategies
}
