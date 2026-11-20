// Browser-safe rules for who may act on which user account (shared by the server functions and tests).

export type Role = "owner" | "exec" | "supervisor" | "employee";
export type Actor = { role: Role; projectIds: string[] };
export type Target = { role: Role; project_ids?: string[] | null };

/**
 * May `actor` delete or reset the password of `target`?
 *  - owner: anyone (the self case is rejected separately by the callers)
 *  - exec: supervisors and employees
 *  - supervisor: employees who work in at least one of the supervisor's projects
 *  - employee: nobody
 */
export function canManageUser(actor: Actor, target: Target): boolean {
  if (actor.role === "owner") return true;
  if (actor.role === "exec") return target.role === "supervisor" || target.role === "employee";
  if (actor.role === "supervisor") {
    return target.role === "employee" && (target.project_ids || []).some((p) => actor.projectIds.includes(p));
  }
  return false;
}
