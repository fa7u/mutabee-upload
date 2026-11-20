import { describe, expect, it } from "vitest";
import { canManageUser } from "@/lib/user-permissions";

const sup = { role: "supervisor" as const, projectIds: ["a"] };

describe("who may delete / reset the password of whom", () => {
  it("owner may act on anyone", () => {
    const owner = { role: "owner" as const, projectIds: [] };
    for (const role of ["exec", "supervisor", "employee"] as const) expect(canManageUser(owner, { role })).toBe(true);
  });
  it("exec may act on supervisors and employees but not on the owner or other execs", () => {
    const exec = { role: "exec" as const, projectIds: [] };
    expect(canManageUser(exec, { role: "supervisor" })).toBe(true);
    expect(canManageUser(exec, { role: "employee" })).toBe(true);
    expect(canManageUser(exec, { role: "owner" })).toBe(false);
    expect(canManageUser(exec, { role: "exec" })).toBe(false);
  });
  it("supervisor may act only on employees of their own projects", () => {
    expect(canManageUser(sup, { role: "employee", project_ids: ["a", "b"] })).toBe(true);
    expect(canManageUser(sup, { role: "employee", project_ids: ["b"] })).toBe(false);
    expect(canManageUser(sup, { role: "employee", project_ids: [] })).toBe(false);
    expect(canManageUser(sup, { role: "employee", project_ids: null })).toBe(false);
    expect(canManageUser(sup, { role: "supervisor", project_ids: ["a"] })).toBe(false);
    expect(canManageUser(sup, { role: "exec" })).toBe(false);
    expect(canManageUser(sup, { role: "owner" })).toBe(false);
  });
  it("employee may act on nobody", () => {
    const emp = { role: "employee" as const, projectIds: ["a"] };
    expect(canManageUser(emp, { role: "employee", project_ids: ["a"] })).toBe(false);
  });
});
