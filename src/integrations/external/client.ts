import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { EXTERNAL_PUBLISHABLE_KEY, EXTERNAL_URL } from "./config";
import { keyFetch } from "./fetch";

export const supabase = createClient<Database>(EXTERNAL_URL, EXTERNAL_PUBLISHABLE_KEY, {
  global: { fetch: keyFetch(EXTERNAL_PUBLISHABLE_KEY) },
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: typeof window !== "undefined",
    autoRefreshToken: typeof window !== "undefined",
    storageKey: "mutabee-external-auth",
  },
});
