import { createBrowserClient } from "@supabase/ssr"

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    },
    auth: {
      // Enables supabase.auth.signInWithPasskey() and supabase.auth.registerPasskey()
      // @ts-expect-error — experimental field not yet in @supabase/ssr type stubs
      experimental: {
        passkey: true
      }
    }
  }
)