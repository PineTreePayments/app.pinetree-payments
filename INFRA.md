# PineTree Infrastructure Reference

> This file is the source of truth for live infrastructure.
> Update it whenever addresses, webhook IDs, or env vars change.
> Claude reads this file at the start of any infra-related session.

---

## Alchemy Webhooks

Both webhooks are "Address Activity" type and route to the PineTree app.

| Webhook ID             | Network | Status | Webhook URL                                              |
|------------------------|---------|--------|----------------------------------------------------------|
| wh_cgj3rsykmjnu24vf    | Solana  | active | https://app.pinetree-payments.com/api/webhooks/solana    |
| wh_oj9wittjxnmfn4fi    | Base    | active | https://app.pinetree-payments.com/api/webhooks/base      |

### Base Webhook — Addresses to Watch

Add these addresses to `wh_oj9wittjxnmfn4fi`:

| Address                                      | What it is                              | Status       |
|----------------------------------------------|-----------------------------------------|--------------|
| PINETREE_TREASURY_WALLET_BASE (from env)     | PineTree fee collection wallet on Base  | check if set |
| 0x0f7BeC33846bAf0dC679Cc67Ed7ba34DD4210162    | Split contract (ETH + USDC on Base)     | ✅ DEPLOYED  |

> Once the PineTreeSplit contract is deployed on Base mainnet (chain ID 8453),
> record its address below and add it to the Alchemy Base webhook.

**PineTreeSplit Contract Address (Base Mainnet):** `NOT YET DEPLOYED`

### Solana Webhook — Addresses to Watch

Add these addresses to `wh_cgj3rsykmjnu24vf`:

| Address                                      | What it is                              | Status       |
|----------------------------------------------|-----------------------------------------|--------------|
| PINETREE_TREASURY_WALLET_SOLANA (from env)   | PineTree fee collection wallet on Solana| check if set |

---

## Vercel Environment Variables

### Required — Base

| Variable                            | Value / Source                          | Set?    |
|-------------------------------------|-----------------------------------------|---------|
| PINETREE_TREASURY_WALLET_BASE       | 0xDfB2EB3FccB76B8C7f7e352d5421654add5a7903 | ✅ SET |
| PINETREE_EVM_SPLIT_MODE             | contract                                | ✅ SET  |
| PINETREE_EVM_SPLIT_CONTRACT_BASE    | 0x0f7BeC33846bAf0dC679Cc67Ed7ba34DD4210162 | ✅ SET |
| ALCHEMY_WEBHOOK_SIGNING_KEY_BASE    | (secret — stored in Vercel only)        | ✅ SET  |
| BASE_RPC_URL                        | https://base-mainnet.g.alchemy.com/v2/lWNP6ao6bTqGId0r3h6lg | ✅ SET |

### Required — Solana

| Variable                            | Value / Source                          | Set?    |
|-------------------------------------|-----------------------------------------|---------|
| PINETREE_TREASURY_WALLET_SOLANA     | CXqPwfvDJ5HYBEwBC9id9oGH9hsf4gShywBN3WzDL5Aw | ✅ SET |
| ALCHEMY_WEBHOOK_SIGNING_KEY_SOLANA  | (secret — stored in Vercel only)        | ✅ SET  |
| RPC_URL_SOLANA                      | Alchemy Solana mainnet RPC URL          | **MUST SET** — code reads this first |

### Required — General

| Variable                            | Value / Source                          | Set?    |
|-------------------------------------|-----------------------------------------|---------|
| NEXT_PUBLIC_APP_URL                 | https://app.pinetree-payments.com       | unknown |
| PINETREE_FEE                        | e.g. `0.01` (1%)                        | unknown |

---

## Contract: PineTreeSplit.sol

**Source:** `contracts/PineTreeSplit.sol`

**Supports:**
- `split(merchant, treasury, merchantAmountWei, feeAmountWei, paymentRef)` — ETH on Base
- `splitToken(merchant, treasury, merchantAmount, feeAmount, paymentRef, token)` — ERC-20 (USDC) on Base

**USDC on Base mainnet:** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

**Deployment steps (Remix):**
1. Go to remix.ethereum.org
2. Paste contents of `contracts/PineTreeSplit.sol`
3. Compile with Solidity 0.8.20
4. Deploy on Base Mainnet (chain ID 8453) via MetaMask/Coinbase Wallet
5. Record the deployed address here and in Vercel env vars

**Deployed address:** `0x0f7BeC33846bAf0dC679Cc67Ed7ba34DD4210162`
**Basescan:** https://basescan.org/address/0x0f7BeC33846bAf0dC679Cc67Ed7ba34DD4210162
**Deployed by:** 0xDfB2EB3FccB76B8C7f7e352d5421654add5a7903 (treasury wallet = contract owner)

---

## Payment Rails Summary

| Network | Asset     | Fee Method      | Watcher Match Logic                        |
|---------|-----------|-----------------|---------------------------------------------|
| Solana  | SOL       | atomic_split    | Memo = paymentId, both wallets receive      |
| Solana  | USDC      | atomic_split    | Memo = paymentId, both wallets receive      |
| Base    | ETH       | contract_split  | to = splitContract, calldata has paymentId  |
| Base    | USDC      | contract_split  | to = splitContract, calldata has paymentId  |
| Shift4  | Card/Fiat | invoice_split   | Shift4 hosted checkout (no blockchain)      |
