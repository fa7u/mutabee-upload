import { beforeEach, describe, expect, it, vi } from "vitest";

const { ownerQuery, createUser } = vi.hoisted(() => ({ ownerQuery: vi.fn(), createUser: vi.fn() }));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      validator: () => builder,
      handler: (handler: (input: unknown) => unknown) => handler,
    };
    return builder;
  },
}));
vi.mock("@/integrations/external/auth", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/external/client.server", () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: ownerQuery }) }),
    auth: { admin: { createUser } },
  },
}));

import { needsSetup, setupOwner } from "@/lib/users.functions";

describe("First-owner setup availability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows setup only when an accurate owner count is zero", async () => {
    ownerQuery.mockResolvedValue({ count: 0, error: null });
    await expect(needsSetup()).resolves.toEqual({ needed: true });
    ownerQuery.mockResolvedValue({ count: 1, error: null });
    await expect(needsSetup()).resolves.toEqual({ needed: false });
  });

  it("fails closed when the database owner check fails", async () => {
    ownerQuery.mockResolvedValue({ count: null, error: { message: "Connection failed" } });
    await expect(needsSetup()).rejects.toThrow();
    await expect(setupOwner({ data: { name: "Test", username: "test", password: "Test-only-12345" } })).rejects.toThrow();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("fails closed when an owner count is unavailable without an explicit error", async () => {
    ownerQuery.mockResolvedValue({ count: null, error: null });
    await expect(needsSetup()).rejects.toThrow();
  });
});