import { supabaseAdmin, supabase } from "@/database"
import { createHash } from "crypto"

const db = supabaseAdmin || supabase

export type TerminalRecord = {
  id: string
  name: string
  pin: string
  autolock: string
  merchant_id: string
  created_at?: string
}

export type CreateTerminalInput = {
  name: string
  pin: string
  autolock: string
  recoveryPhrase: string
}

type ErrorWithStatus = Error & { status?: number }

function hashRecoveryPhrase(phrase: string) {
  return createHash("sha256").update(phrase.trim()).digest("hex")
}

export async function getPosTerminalsEngine(merchantId: string): Promise<TerminalRecord[]> {
  const { data, error } = await db
    .from("terminals")
    .select("id,name,pin,autolock,merchant_id,created_at")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(`Failed to load terminals: ${error.message}`)
  }

  return (data || []) as TerminalRecord[]
}

export async function createPosTerminalEngine(
  merchantId: string,
  input: CreateTerminalInput
): Promise<TerminalRecord> {
  const { data, error } = await db
    .from("terminals")
    .insert({
      merchant_id: merchantId,
      name: input.name,
      pin: input.pin,
      autolock: input.autolock
    })
    .select("id,name,pin,autolock,merchant_id,created_at")
    .single()

  if (error) {
    throw new Error(`Failed to create terminal: ${error.message}`)
  }

  const { error: credentialError } = await db
    .from("merchant_credentials")
    .upsert({
      merchant_id: merchantId,
      credential_key: `terminal_recovery_phrase:${data.id}`,
      value: hashRecoveryPhrase(input.recoveryPhrase)
    })

  if (credentialError) {
    throw new Error(`Failed to store terminal recovery phrase: ${credentialError.message}`)
  }

  return data as TerminalRecord
}

export async function resetPosTerminalPinWithRecoveryEngine(
  terminalId: string,
  recoveryPhrase: string,
  newPin: string
) {
  const { data: terminal, error: terminalError } = await db
    .from("terminals")
    .select("id,merchant_id")
    .eq("id", terminalId)
    .maybeSingle()

  if (terminalError || !terminal) {
    const err = new Error("Terminal not found") as ErrorWithStatus
    err.status = 404
    throw err
  }

  const { data: credential, error: credentialError } = await db
    .from("merchant_credentials")
    .select("value")
    .eq("merchant_id", terminal.merchant_id)
    .eq("credential_key", `terminal_recovery_phrase:${terminal.id}`)
    .maybeSingle()

  if (credentialError || !credential?.value) {
    const err = new Error("Recovery phrase not configured for this terminal") as ErrorWithStatus
    err.status = 400
    throw err
  }

  const incomingHash = hashRecoveryPhrase(recoveryPhrase)
  if (credential.value !== incomingHash) {
    const err = new Error("Recovery phrase is invalid") as ErrorWithStatus
    err.status = 401
    throw err
  }

  const { error: updateError } = await db
    .from("terminals")
    .update({ pin: newPin })
    .eq("id", terminal.id)

  if (updateError) {
    throw new Error(`Failed to reset terminal PIN: ${updateError.message}`)
  }

  return { success: true }
}

export async function deletePosTerminalEngine(merchantId: string, terminalId: string) {
  const { error } = await db
    .from("terminals")
    .delete()
    .eq("id", terminalId)
    .eq("merchant_id", merchantId)

  if (error) {
    throw new Error(`Failed to delete terminal: ${error.message}`)
  }
}
