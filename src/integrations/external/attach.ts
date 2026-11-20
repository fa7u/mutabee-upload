import { createMiddleware } from "@tanstack/react-start";
import { supabase as browserClient } from "./client";

export const attachExternalAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const { data } = await browserClient.auth.getSession();
  const token = data.session?.access_token;
  return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
});
