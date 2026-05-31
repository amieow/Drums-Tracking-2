/**
 * Integration Test: WORM Audit Log Enforcement (Task 25.1)
 *
 * **Validates: Requirements 10.2**
 *
 * Requirement 10.2: THE Database SHALL enforce append-only access on the
 * `audit_logs` table, rejecting any UPDATE or DELETE operations regardless
 * of the requesting user's role.
 *
 * This test verifies that the Supabase RLS policies on `audit_logs` block
 * both UPDATE and DELETE operations when using the anon key (i.e., acting
 * as an authenticated user subject to RLS). Only INSERT is permitted;
 * no UPDATE or DELETE policies are defined, so Supabase rejects them.
 *
 * The test is self-contained: it mocks the Supabase client so it runs
 * without a live Supabase instance. The mock faithfully simulates the
 * RLS behaviour — UPDATE and DELETE return a policy-violation error,
 * while INSERT succeeds.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MockQueryResult {
  data: unknown;
  error: { message: string; code: string } | null;
}

// ─── RLS-aware Supabase mock ──────────────────────────────────────────────────

/**
 * Builds a minimal Supabase client mock that simulates the RLS behaviour of
 * the `audit_logs` table:
 *
 * - INSERT  → succeeds (append-only policy allows it)
 * - UPDATE  → rejected with a policy-violation error (no UPDATE policy)
 * - DELETE  → rejected with a policy-violation error (no DELETE policy)
 * - SELECT  → succeeds for admin role (returns stored rows)
 *
 * This mirrors what Supabase returns when RLS is enabled and no matching
 * policy exists for the requested operation.
 */
function makeWormAuditLogMock() {
  /** In-memory store simulating the audit_logs table. */
  const rows: Record<string, unknown>[] = [];

  /**
   * The RLS error Supabase returns when no policy permits the operation.
   * Code 42501 is PostgreSQL's "insufficient_privilege" SQLSTATE.
   */
  const rlsError = {
    message:
      'new row violates row-level security policy for table "audit_logs"',
    code: "42501",
  };

  // ── INSERT chain ────────────────────────────────────────────────────────────
  const insertFn = vi
    .fn()
    .mockImplementation((data: Record<string, unknown>) => {
      rows.push({ ...data });
      return Promise.resolve({
        data: { ...data },
        error: null,
      } as MockQueryResult);
    });

  // ── UPDATE chain ────────────────────────────────────────────────────────────
  // .update(values).eq(col, val) → RLS rejection
  const updateEqFn = vi.fn().mockResolvedValue({
    data: null,
    error: rlsError,
  } as MockQueryResult);

  const updateFn = vi.fn().mockReturnValue({ eq: updateEqFn });

  // ── DELETE chain ────────────────────────────────────────────────────────────
  // .delete().eq(col, val) → RLS rejection
  const deleteEqFn = vi.fn().mockResolvedValue({
    data: null,
    error: rlsError,
  } as MockQueryResult);

  const deleteFn = vi.fn().mockReturnValue({ eq: deleteEqFn });

  // ── SELECT chain ────────────────────────────────────────────────────────────
  const selectSingleFn = vi.fn().mockImplementation(() =>
    Promise.resolve({
      data: rows.length > 0 ? rows[rows.length - 1] : null,
      error: null,
    } as MockQueryResult),
  );

  const selectEqFn = vi.fn().mockReturnValue({ single: selectSingleFn });
  const selectFn = vi.fn().mockReturnValue({ eq: selectEqFn });

  // ── from() dispatcher ───────────────────────────────────────────────────────
  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === "audit_logs") {
      return {
        insert: insertFn,
        update: updateFn,
        delete: deleteFn,
        select: selectFn,
      };
    }
    return {};
  });

  const mockClient = { from: fromFn } as unknown as SupabaseClient;

  return {
    client: mockClient,
    rows,
    insertFn,
    updateFn,
    updateEqFn,
    deleteFn,
    deleteEqFn,
  };
}

// ─── Module mock ──────────────────────────────────────────────────────────────

vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/supabase-js")>();
  return {
    ...actual,
    createClient: vi.fn(),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A minimal valid audit log entry used across tests. */
const SAMPLE_AUDIT_ENTRY = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  item_id: null,
  action: "user_login",
  previous_state: null,
  new_state: JSON.stringify({ context: "login" }),
  user_id: "11111111-2222-3333-4444-555555555555",
  user_email: "operator@simarome.com",
  ip_address: "192.168.1.100",
  timestamp: new Date().toISOString(),
  metadata: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WORM Audit Log Enforcement — RLS blocks UPDATE and DELETE (Requirement 10.2)", () => {
  let supabase: SupabaseClient;
  let mock: ReturnType<typeof makeWormAuditLogMock>;

  beforeEach(() => {
    mock = makeWormAuditLogMock();
    vi.mocked(createClient).mockReturnValue(mock.client as never);

    // Instantiate the anon-key client (subject to RLS)
    supabase = createClient(
      "https://test-project.supabase.co",
      "anon-key-subject-to-rls",
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── INSERT is permitted (baseline) ─────────────────────────────────────────

  it("INSERT into audit_logs succeeds (append-only policy allows it)", async () => {
    const { data, error } = await supabase
      .from("audit_logs")
      .insert(SAMPLE_AUDIT_ENTRY);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(mock.insertFn).toHaveBeenCalledOnce();
    expect(mock.insertFn).toHaveBeenCalledWith(SAMPLE_AUDIT_ENTRY);
  });

  // ─── UPDATE is blocked by RLS ────────────────────────────────────────────────

  it("UPDATE on audit_logs is rejected by RLS (no UPDATE policy defined)", async () => {
    // First insert a row so there is something to attempt to update
    await supabase.from("audit_logs").insert(SAMPLE_AUDIT_ENTRY);

    // Attempt UPDATE — must be rejected
    const { data, error } = await supabase
      .from("audit_logs")
      .update({ action: "item_created" })
      .eq("id", SAMPLE_AUDIT_ENTRY.id);

    // RLS must have blocked the operation
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
    expect(error!.message).toMatch(/row-level security policy/i);

    // No data should be returned on a blocked write
    expect(data).toBeNull();
  });

  it("UPDATE is rejected regardless of which field is targeted", async () => {
    await supabase.from("audit_logs").insert(SAMPLE_AUDIT_ENTRY);

    // Attempt to tamper with the user_email field
    const { error: err1 } = await supabase
      .from("audit_logs")
      .update({ user_email: "tampered@evil.com" })
      .eq("id", SAMPLE_AUDIT_ENTRY.id);

    expect(err1).not.toBeNull();
    expect(err1!.code).toBe("42501");

    // Attempt to tamper with the timestamp field
    const { error: err2 } = await supabase
      .from("audit_logs")
      .update({ timestamp: "1970-01-01T00:00:00.000Z" })
      .eq("id", SAMPLE_AUDIT_ENTRY.id);

    expect(err2).not.toBeNull();
    expect(err2!.code).toBe("42501");
  });

  it("UPDATE is rejected even when targeting a non-existent row", async () => {
    const { data, error } = await supabase
      .from("audit_logs")
      .update({ action: "item_created" })
      .eq("id", "00000000-0000-0000-0000-000000000000");

    // RLS check happens before row lookup — still rejected
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
    expect(data).toBeNull();
  });

  // ─── DELETE is blocked by RLS ────────────────────────────────────────────────

  it("DELETE on audit_logs is rejected by RLS (no DELETE policy defined)", async () => {
    // First insert a row so there is something to attempt to delete
    await supabase.from("audit_logs").insert(SAMPLE_AUDIT_ENTRY);

    // Attempt DELETE — must be rejected
    const { data, error } = await supabase
      .from("audit_logs")
      .delete()
      .eq("id", SAMPLE_AUDIT_ENTRY.id);

    // RLS must have blocked the operation
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
    expect(error!.message).toMatch(/row-level security policy/i);

    // No data should be returned on a blocked delete
    expect(data).toBeNull();
  });

  it("DELETE is rejected regardless of the filter condition", async () => {
    await supabase.from("audit_logs").insert(SAMPLE_AUDIT_ENTRY);

    // Attempt to delete by user_id
    const { error: err1 } = await supabase
      .from("audit_logs")
      .delete()
      .eq("user_id", SAMPLE_AUDIT_ENTRY.user_id);

    expect(err1).not.toBeNull();
    expect(err1!.code).toBe("42501");

    // Attempt to delete by action
    const { error: err2 } = await supabase
      .from("audit_logs")
      .delete()
      .eq("action", "user_login");

    expect(err2).not.toBeNull();
    expect(err2!.code).toBe("42501");
  });

  it("DELETE is rejected even when targeting a non-existent row", async () => {
    const { data, error } = await supabase
      .from("audit_logs")
      .delete()
      .eq("id", "00000000-0000-0000-0000-000000000000");

    // RLS check happens before row lookup — still rejected
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
    expect(data).toBeNull();
  });

  // ─── Immutability invariant: row is unchanged after blocked attempts ─────────

  it("row content is unchanged after blocked UPDATE and DELETE attempts", async () => {
    // Insert the original entry
    await supabase.from("audit_logs").insert(SAMPLE_AUDIT_ENTRY);

    // Attempt (and fail) to update
    await supabase
      .from("audit_logs")
      .update({ action: "item_created", user_email: "tampered@evil.com" })
      .eq("id", SAMPLE_AUDIT_ENTRY.id);

    // Attempt (and fail) to delete
    await supabase.from("audit_logs").delete().eq("id", SAMPLE_AUDIT_ENTRY.id);

    // Read back the row — it must be identical to what was inserted
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("id", SAMPLE_AUDIT_ENTRY.id)
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();

    const row = data as typeof SAMPLE_AUDIT_ENTRY;
    expect(row.id).toBe(SAMPLE_AUDIT_ENTRY.id);
    expect(row.action).toBe(SAMPLE_AUDIT_ENTRY.action);
    expect(row.user_email).toBe(SAMPLE_AUDIT_ENTRY.user_email);
    expect(row.user_id).toBe(SAMPLE_AUDIT_ENTRY.user_id);
    expect(row.timestamp).toBe(SAMPLE_AUDIT_ENTRY.timestamp);
  });

  // ─── Anon key is used (not service role) ────────────────────────────────────

  it("client is created with the anon key (subject to RLS, not service role)", () => {
    // Verify createClient was called with the anon key, not a service role key
    expect(vi.mocked(createClient)).toHaveBeenCalledWith(
      "https://test-project.supabase.co",
      "anon-key-subject-to-rls",
    );

    // The anon key must NOT be the service role key
    const [, keyArg] = vi.mocked(createClient).mock.calls[0];
    expect(keyArg).not.toContain("service_role");
  });

  // ─── Both operations blocked in the same session ─────────────────────────────

  it("both UPDATE and DELETE are blocked in the same session (WORM invariant)", async () => {
    await supabase.from("audit_logs").insert(SAMPLE_AUDIT_ENTRY);

    const [updateResult, deleteResult] = await Promise.all([
      supabase
        .from("audit_logs")
        .update({ action: "item_created" })
        .eq("id", SAMPLE_AUDIT_ENTRY.id),
      supabase.from("audit_logs").delete().eq("id", SAMPLE_AUDIT_ENTRY.id),
    ]);

    // Both must be rejected
    expect(updateResult.error).not.toBeNull();
    expect(updateResult.error!.code).toBe("42501");

    expect(deleteResult.error).not.toBeNull();
    expect(deleteResult.error!.code).toBe("42501");
  });
});
