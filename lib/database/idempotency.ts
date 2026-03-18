import { supabase } from "./supabase"

export async function checkIdempotency(key:string){

  const { data } = await supabase
    .from("idempotency_keys")
    .select("key")
    .eq("key", key)
    .single()

  if(data){
    return true
  }

  return false
}

export async function storeIdempotency(key:string){

  await supabase
    .from("idempotency_keys")
    .insert({ key })

}