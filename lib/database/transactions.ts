import { createClient } from "@supabase/supabase-js";

export async function createTransaction({
  merchant_id,
  amount,
  provider,
  provider_transaction_id,
  status,
}: any) {

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      merchant_id,
      amount,
      provider,
      provider_transaction_id,
      status,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}