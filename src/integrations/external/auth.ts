import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { EXTERNAL_PUBLISHABLE_KEY, EXTERNAL_URL } from "./config";
import { keyFetch } from "./fetch";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const h = getRequest()?.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (token.split(".").length !== 3) throw new Error("Unauthorized");
  const supabase = createClient<Database>(EXTERNAL_URL, EXTERNAL_PUBLISHABLE_KEY, {
    global: { fetch: keyFetch(EXTERNAL_PUBLISHABLE_KEY), headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw new Error("Unauthorized");
  return next({ context: { supabase, userId: data.user.id, claims: { sub: data.user.id } } });
});
