"use client";

/**
 * Admin User Management Page — `/admin`
 *
 * Admin-only page for managing system users. Redirects non-admin users to `/`.
 *
 * Features:
 *  - Table of all users with email, role, and status (active / disabled)
 *  - Form to create a new user (email, password, role)
 *  - Per-row buttons to update a user's role and deactivate (disable) a user
 *
 * Requirements: 2.4
 */

import { useAuth, useRequireAuth } from "@/lib/auth-context";
import type { UserRole } from "@/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  banned: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, string> };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES: UserRole[] = ["operator", "qc", "ppic", "admin"];

const ROLE_COLORS: Record<UserRole, { bg: string; text: string }> = {
  admin: { bg: "#fef3c7", text: "#92400e" },
  operator: { bg: "#dbeafe", text: "#1e40af" },
  qc: { bg: "#dcfce7", text: "#166534" },
  ppic: { bg: "#f3e8ff", text: "#6b21a8" },
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: "100dvh",
    backgroundColor: "#f8fafc",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#0f172a",
  },
  header: {
    backgroundColor: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
    padding: "20px 32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap" as const,
  },
  headerLeft: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "#0f172a",
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: "#64748b",
  },
  body: {
    padding: "24px 32px",
    maxWidth: 1200,
    margin: "0 auto",
  },
  card: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 24,
  },
  cardHeader: {
    padding: "16px 24px",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: {
    margin: 0,
    fontSize: 15,
    fontWeight: 700,
    color: "#0f172a",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 16,
    padding: "20px 24px",
    alignItems: "end",
  },
  formGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  input: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    fontSize: 14,
    color: "#0f172a",
    backgroundColor: "#ffffff",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  select: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    fontSize: 14,
    color: "#0f172a",
    backgroundColor: "#ffffff",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
    cursor: "pointer",
  },
  primaryBtn: {
    padding: "9px 20px",
    borderRadius: 8,
    border: "none",
    backgroundColor: "#0f172a",
    color: "#ffffff",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    alignSelf: "flex-end" as const,
  },
  primaryBtnDisabled: {
    backgroundColor: "#94a3b8",
    cursor: "not-allowed",
  },
  dangerBtn: {
    padding: "5px 12px",
    borderRadius: 6,
    border: "1px solid #fca5a5",
    backgroundColor: "#fef2f2",
    color: "#b91c1c",
    fontWeight: 600,
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  dangerBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  inlineSelect: {
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    fontSize: 12,
    color: "#0f172a",
    backgroundColor: "#ffffff",
    cursor: "pointer",
  },
  saveBtn: {
    padding: "5px 12px",
    borderRadius: 6,
    border: "none",
    backgroundColor: "#3b82f6",
    color: "#ffffff",
    fontWeight: 600,
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  saveBtnDisabled: {
    backgroundColor: "#93c5fd",
    cursor: "not-allowed",
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

// ─── Role Badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: UserRole }) {
  const colors = ROLE_COLORS[role] ?? { bg: "#f1f5f9", text: "#475569" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.03em",
        backgroundColor: colors.bg,
        color: colors.text,
        whiteSpace: "nowrap",
      }}
    >
      {role}
    </span>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ banned }: { banned: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.03em",
        backgroundColor: banned ? "#fef2f2" : "#dcfce7",
        color: banned ? "#b91c1c" : "#166534",
        whiteSpace: "nowrap",
      }}
    >
      {banned ? "Disabled" : "Active"}
    </span>
  );
}

// ─── Alert Banner ─────────────────────────────────────────────────────────────

function Alert({
  message,
  type,
  onDismiss,
}: {
  message: string;
  type: "error" | "success";
  onDismiss: () => void;
}) {
  const isError = type === "error";
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        marginBottom: 16,
        padding: "12px 16px",
        backgroundColor: isError ? "#fef2f2" : "#f0fdf4",
        border: `1px solid ${isError ? "#fca5a5" : "#86efac"}`,
        borderRadius: 8,
        color: isError ? "#b91c1c" : "#166534",
        fontSize: 14,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const user = useRequireAuth();
  const { token } = useAuth();
  const router = useRouter();

  // ── Redirect non-admin users ───────────────────────────────────────────────
  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/");
    }
  }, [user, router]);

  // ── Users list state ───────────────────────────────────────────────────────
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // ── Create user form state ─────────────────────────────────────────────────
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("operator");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // ── Per-row edit state ─────────────────────────────────────────────────────
  // Maps userId → selected role in the inline dropdown
  const [pendingRoles, setPendingRoles] = useState<Record<string, UserRole>>(
    {},
  );
  // Maps userId → saving in progress
  const [savingRole, setSavingRole] = useState<Record<string, boolean>>({});
  // Maps userId → deactivating in progress
  const [deactivating, setDeactivating] = useState<Record<string, boolean>>({});

  // ── Global action feedback ─────────────────────────────────────────────────
  const [actionMessage, setActionMessage] = useState<{
    text: string;
    type: "error" | "success";
  } | null>(null);

  // ── Fetch users ────────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async () => {
    if (!token) return;
    setLoadingUsers(true);
    setListError(null);

    try {
      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json: ApiResponse<AdminUser[]> = await res.json();

      if (!json.success) {
        setListError(json.error?.message ?? "Failed to load users.");
        return;
      }
      setUsers(json.data ?? []);
    } catch {
      setListError("Network error — could not load users.");
    } finally {
      setLoadingUsers(false);
    }
  }, [token]);

  // Load on mount (once user is confirmed admin)
  useEffect(() => {
    if (user?.role === "admin") {
      fetchUsers();
    }
  }, [user, fetchUsers]);

  // ── Create user ────────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!token) return;
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: newEmail.trim(),
          password: newPassword,
          role: newRole,
        }),
      });
      const json: ApiResponse<AdminUser> = await res.json();

      if (!json.success) {
        const details = json.error?.details;
        const detailMsg = details ? Object.values(details).join(" ") : "";
        setCreateError(
          detailMsg || json.error?.message || "Failed to create user.",
        );
        return;
      }

      setCreateSuccess(`User ${json.data?.email} created successfully.`);
      setNewEmail("");
      setNewPassword("");
      setNewRole("operator");
      // Refresh the list
      await fetchUsers();
    } catch {
      setCreateError("Network error — could not create user.");
    } finally {
      setCreating(false);
    }
  }, [token, newEmail, newPassword, newRole, fetchUsers]);

  // ── Update role ────────────────────────────────────────────────────────────
  const handleSaveRole = useCallback(
    async (userId: string) => {
      if (!token) return;
      const role = pendingRoles[userId];
      if (!role) return;

      setSavingRole((prev) => ({ ...prev, [userId]: true }));
      setActionMessage(null);

      try {
        const res = await fetch(`/api/admin/users/${userId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ role }),
        });
        const json: ApiResponse<AdminUser> = await res.json();

        if (!json.success) {
          setActionMessage({
            text: json.error?.message ?? "Failed to update role.",
            type: "error",
          });
          return;
        }

        setActionMessage({
          text: `Role updated successfully.`,
          type: "success",
        });
        // Clear pending edit and refresh
        setPendingRoles((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
        await fetchUsers();
      } catch {
        setActionMessage({
          text: "Network error — could not update role.",
          type: "error",
        });
      } finally {
        setSavingRole((prev) => ({ ...prev, [userId]: false }));
      }
    },
    [token, pendingRoles, fetchUsers],
  );

  // ── Deactivate user ────────────────────────────────────────────────────────
  const handleDeactivate = useCallback(
    async (userId: string, email: string) => {
      if (!token) return;
      if (
        !window.confirm(
          `Deactivate user "${email}"? They will no longer be able to log in.`,
        )
      ) {
        return;
      }

      setDeactivating((prev) => ({ ...prev, [userId]: true }));
      setActionMessage(null);

      try {
        const res = await fetch(`/api/admin/users/${userId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        const json: ApiResponse<{ id: string }> = await res.json();

        if (!json.success) {
          setActionMessage({
            text: json.error?.message ?? "Failed to deactivate user.",
            type: "error",
          });
          return;
        }

        setActionMessage({
          text: `User "${email}" has been deactivated.`,
          type: "success",
        });
        await fetchUsers();
      } catch {
        setActionMessage({
          text: "Network error — could not deactivate user.",
          type: "error",
        });
      } finally {
        setDeactivating((prev) => ({ ...prev, [userId]: false }));
      }
    },
    [token, fetchUsers],
  );

  // ── Guard: still loading auth or not admin ─────────────────────────────────
  if (!user || user.role !== "admin") {
    return null;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={styles.page} aria-label="Admin User Management">
      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>User Management</h1>
          <p style={styles.subtitle}>
            Create, update, and deactivate system users — admin access only
          </p>
        </div>

        <button
          onClick={fetchUsers}
          disabled={loadingUsers}
          aria-label="Refresh user list"
          style={{
            ...styles.primaryBtn,
            ...(loadingUsers ? styles.primaryBtnDisabled : {}),
          }}
        >
          {loadingUsers ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <div style={styles.body}>
        {/* ── Global action feedback ──────────────────────────────────────── */}
        {actionMessage && (
          <Alert
            message={actionMessage.text}
            type={actionMessage.type}
            onDismiss={() => setActionMessage(null)}
          />
        )}

        {/* ── Create User Card ────────────────────────────────────────────── */}
        <section style={styles.card} aria-label="Create new user">
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>Create New User</h2>
          </div>

          {createError && (
            <div style={{ padding: "0 24px" }}>
              <Alert
                message={createError}
                type="error"
                onDismiss={() => setCreateError(null)}
              />
            </div>
          )}
          {createSuccess && (
            <div style={{ padding: "0 24px" }}>
              <Alert
                message={createSuccess}
                type="success"
                onDismiss={() => setCreateSuccess(null)}
              />
            </div>
          )}

          <div style={styles.formGrid}>
            {/* Email */}
            <div style={styles.formGroup}>
              <label htmlFor="new-email" style={styles.label}>
                Email
              </label>
              <input
                id="new-email"
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                style={styles.input}
                aria-label="New user email"
                autoComplete="off"
              />
            </div>

            {/* Password */}
            <div style={styles.formGroup}>
              <label htmlFor="new-password" style={styles.label}>
                Password
              </label>
              <input
                id="new-password"
                type="password"
                placeholder="Min. 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={styles.input}
                aria-label="New user password"
                autoComplete="new-password"
              />
            </div>

            {/* Role */}
            <div style={styles.formGroup}>
              <label htmlFor="new-role" style={styles.label}>
                Role
              </label>
              <select
                id="new-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                style={styles.select}
                aria-label="New user role"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            {/* Submit */}
            <button
              onClick={handleCreate}
              disabled={creating || !newEmail.trim() || !newPassword}
              aria-label="Create user"
              aria-busy={creating}
              style={{
                ...styles.primaryBtn,
                ...(creating || !newEmail.trim() || !newPassword
                  ? styles.primaryBtnDisabled
                  : {}),
              }}
            >
              {creating ? "Creating…" : "Create User"}
            </button>
          </div>
        </section>

        {/* ── Users Table ─────────────────────────────────────────────────── */}
        <section style={styles.card} aria-label="Users list">
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>
              All Users{" "}
              {!loadingUsers && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#64748b",
                    marginLeft: 6,
                  }}
                >
                  ({users.length})
                </span>
              )}
            </h2>
          </div>

          {listError && (
            <div style={{ padding: "0 24px 16px" }}>
              <Alert
                message={listError}
                type="error"
                onDismiss={() => setListError(null)}
              />
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
              aria-label="Users table"
            >
              <thead>
                <tr
                  style={{
                    backgroundColor: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                  }}
                >
                  {[
                    "Email",
                    "Role",
                    "Status",
                    "Created",
                    "Last Sign-in",
                    "Actions",
                  ].map((col) => (
                    <th
                      key={col}
                      scope="col"
                      style={{
                        padding: "10px 16px",
                        textAlign: "left",
                        fontWeight: 600,
                        color: "#475569",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {loadingUsers ? (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        padding: "48px 24px",
                        textAlign: "center",
                        color: "#94a3b8",
                        fontSize: 14,
                      }}
                    >
                      Loading users…
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        padding: "48px 24px",
                        textAlign: "center",
                        color: "#94a3b8",
                        fontSize: 14,
                      }}
                    >
                      No users found.
                    </td>
                  </tr>
                ) : (
                  users.map((u, idx) => {
                    const pendingRole = pendingRoles[u.id] ?? u.role;
                    const roleChanged = pendingRole !== u.role;
                    const isSaving = savingRole[u.id] ?? false;
                    const isDeactivating = deactivating[u.id] ?? false;
                    const isSelf = u.id === user.id;

                    return (
                      <tr
                        key={u.id}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          backgroundColor:
                            idx % 2 === 0 ? "#ffffff" : "#fafafa",
                        }}
                      >
                        {/* Email */}
                        <td
                          style={{
                            padding: "10px 16px",
                            color: "#334155",
                            maxWidth: 240,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={u.email}
                        >
                          {u.email}
                          {isSelf && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 10,
                                color: "#64748b",
                                fontWeight: 600,
                              }}
                            >
                              (you)
                            </span>
                          )}
                        </td>

                        {/* Role — inline editable dropdown */}
                        <td
                          style={{
                            padding: "10px 16px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {u.banned ? (
                            <RoleBadge role={u.role} />
                          ) : (
                            <select
                              value={pendingRole}
                              onChange={(e) =>
                                setPendingRoles((prev) => ({
                                  ...prev,
                                  [u.id]: e.target.value as UserRole,
                                }))
                              }
                              style={styles.inlineSelect}
                              aria-label={`Role for ${u.email}`}
                              disabled={isSaving}
                            >
                              {ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>

                        {/* Status */}
                        <td
                          style={{
                            padding: "10px 16px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <StatusBadge banned={u.banned} />
                        </td>

                        {/* Created */}
                        <td
                          style={{
                            padding: "10px 16px",
                            color: "#64748b",
                            whiteSpace: "nowrap",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {formatDate(u.created_at)}
                        </td>

                        {/* Last Sign-in */}
                        <td
                          style={{
                            padding: "10px 16px",
                            color: "#64748b",
                            whiteSpace: "nowrap",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {formatDate(u.last_sign_in_at)}
                        </td>

                        {/* Actions */}
                        <td
                          style={{
                            padding: "10px 16px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                            }}
                          >
                            {/* Save role button — only shown when role changed */}
                            {!u.banned && roleChanged && (
                              <button
                                onClick={() => handleSaveRole(u.id)}
                                disabled={isSaving}
                                aria-label={`Save role for ${u.email}`}
                                aria-busy={isSaving}
                                style={{
                                  ...styles.saveBtn,
                                  ...(isSaving ? styles.saveBtnDisabled : {}),
                                }}
                              >
                                {isSaving ? "Saving…" : "Save Role"}
                              </button>
                            )}

                            {/* Deactivate button */}
                            {!u.banned && !isSelf && (
                              <button
                                onClick={() => handleDeactivate(u.id, u.email)}
                                disabled={isDeactivating}
                                aria-label={`Deactivate ${u.email}`}
                                aria-busy={isDeactivating}
                                style={{
                                  ...styles.dangerBtn,
                                  ...(isDeactivating
                                    ? styles.dangerBtnDisabled
                                    : {}),
                                }}
                              >
                                {isDeactivating
                                  ? "Deactivating…"
                                  : "Deactivate"}
                              </button>
                            )}

                            {/* Already disabled indicator */}
                            {u.banned && (
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#94a3b8",
                                  fontStyle: "italic",
                                }}
                              >
                                Disabled
                              </span>
                            )}

                            {/* Self-protection note */}
                            {isSelf && !u.banned && (
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#94a3b8",
                                  fontStyle: "italic",
                                }}
                              >
                                —
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
