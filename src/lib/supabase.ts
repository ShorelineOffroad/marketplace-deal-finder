import { createClient } from "@supabase/supabase-js";

// Server-only client using the secret key — full read/write access, bypasses row-level
// security. Never import this from client-side code.
export function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
