import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    );

    const { error } = await supabase
      .from("merchants")
      .update({
        application_started: true,
        application_status: "pending"
      })
      .eq("email", email);

    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    return NextResponse.json({
      url: "https://www.shift4.com/" // placeholder until they send embed URL
    });

  } catch (err) {
    return NextResponse.json(
      { error: "Failed to start Shift4 onboarding" },
      { status: 500 }
    );
  }
}