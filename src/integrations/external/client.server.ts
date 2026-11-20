import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { EXTERNAL_URL } from "./config";
import { keyFetch } from "./fetch";

function make() {
  const key = process.env['EXTERNAL_SUPABASE_SERVICE_ROLE_KEY'];
  if (!key) throw new Error("Missing EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
  return createClient<Database>(EXTERNAL_URL, key, {
    global: { fetch: keyFetch(key) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}
let c: ReturnType<typeof make> | undefined;
export const supabaseAdmin = new Proxy({} as ReturnType<typeof make>, {
  get(_, p, r) { if (!c) c = make(); return Reflect.get(c, p, r); },
});
