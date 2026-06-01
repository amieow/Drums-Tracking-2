"use client";

import NavBar from "@/components/NavBar";
import { useAuth, useRequireAuth } from "@/lib/auth-context";
import type { UserRole } from "@/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

const ROLES: UserRole[] = ["operator", "qc", "ppic", "admin"];

const ROLE_COLORS: Record<UserRole, { bg: string; text: string }> = {
  admin: { bg: "#fef3c7", text: "#92400e" },
  operator: { bg: "#dbeafe", text: "#1e40af" },
  qc: { bg: "#dcfce7", text: "#166534" },
  ppic: { bg: "#f3e8ff", text: "#6b21a8" },
};

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

function RoleBadge({ role }: { role: UserRole }) {
  const colors = ROLE_COLORS[role] ?? { bg: "#f1f5f9", text: "#475569" };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wider whitespace-nowrap"
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
      }}
    >
      {role}
    </span>
  );
}

function StatusBadge({ banned }: { banned: boolean }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wider whitespace-nowrap"
      style={{
        backgroundColor: banned ? "#fef2f2" : "#dcfce7",
        color: banned ? "#b91c1c" : "#166534",
      }}
    >
      {banned ? "Disabled" : "Active"}
    </span>
  );
}

function AlertBanner({
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
      className={cn(
        "mb-4 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2",
        isError
          ? "bg-red-50 border border-red-200 text-red-700"
          : "bg-green-50 border border-green-200 text-green-700"
      )}
    >
      <span className="flex-1">{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="bg-none border-none cursor-pointer text-inherit text-lg leading-none p-0"
      >
        ×
      </button>
    </div>
  );
}

export default function AdminPage() {
  const user = useRequireAuth();
  const { token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/");
    }
  }, [user, router]);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("operator");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const [pendingRoles, setPendingRoles] = useState<Record<string, UserRole>>({});
  const [savingRole, setSavingRole] = useState<Record<string, boolean>>({});
  const [deactivating, setDeactivating] = useState<Record<string, boolean>>({});

  const [actionMessage, setActionMessage] = useState<{
    text: string;
    type: "error" | "success";
  } | null>(null);

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

  useEffect(() => {
    if (user?.role === "admin") {
      fetchUsers();
    }
  }, [user, fetchUsers]);

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
      await fetchUsers();
    } catch {
      setCreateError("Network error — could not create user.");
    } finally {
      setCreating(false);
    }
  }, [token, newEmail, newPassword, newRole, fetchUsers]);

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

  if (!user || user.role !== "admin") {
    return null;
  }

  return (
    <main className="min-h-dvh bg-slate-50 text-slate-900">
      <NavBar title="User Management" />

      <header className="bg-white border-b px-8 py-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight m-0">
            User Management
          </h1>
          <p className="text-sm text-slate-500 m-0 mt-1">
            Create, update, and deactivate system users — admin access only
          </p>
        </div>

        <Button
          onClick={fetchUsers}
          disabled={loadingUsers}
          className="bg-slate-900 hover:bg-slate-800 text-white font-semibold disabled:bg-slate-400"
        >
          {loadingUsers ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      <div className="max-w-5xl mx-auto px-8 py-6">
        {actionMessage && (
          <AlertBanner
            message={actionMessage.text}
            type={actionMessage.type}
            onDismiss={() => setActionMessage(null)}
          />
        )}

        <Card className="mb-6 border-slate-200">
          <CardHeader className="p-5 pb-4 border-b">
            <CardTitle className="text-base font-bold">
              Create New User
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {createError && (
              <AlertBanner
                message={createError}
                type="error"
                onDismiss={() => setCreateError(null)}
              />
            )}
            {createSuccess && (
              <AlertBanner
                message={createSuccess}
                type="success"
                onDismiss={() => setCreateSuccess(null)}
              />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="new-email"
                  className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
                >
                  Email
                </label>
                <Input
                  id="new-email"
                  type="email"
                  placeholder="user@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="border-slate-300"
                  aria-label="New user email"
                  autoComplete="off"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="new-password"
                  className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
                >
                  Password
                </label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="Min. 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="border-slate-300"
                  aria-label="New user password"
                  autoComplete="new-password"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="new-role"
                  className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
                >
                  Role
                </label>
                <select
                  id="new-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  aria-label="New user role"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                onClick={handleCreate}
                disabled={creating || !newEmail.trim() || !newPassword}
                className="bg-slate-900 hover:bg-slate-800 text-white font-semibold disabled:bg-slate-400"
              >
                {creating ? "Creating…" : "Create User"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="p-5 pb-4 border-b">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              All Users{" "}
              {!loadingUsers && (
                <span className="text-sm font-normal text-slate-500">
                  ({users.length})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {listError && (
              <div className="p-5 pt-0">
                <AlertBanner
                  message={listError}
                  type="error"
                  onDismiss={() => setListError(null)}
                />
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
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
                        className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap"
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
                        className="px-4 py-12 text-center text-slate-400"
                      >
                        Loading users…
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-12 text-center text-slate-400"
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
                          className={cn(
                            "border-b border-slate-100",
                            idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                          )}
                        >
                          <td className="px-4 py-2.5 text-slate-700 max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap">
                            {u.email}
                            {isSelf && (
                              <span className="ml-1.5 text-[10px] font-semibold text-slate-500">
                                (you)
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-2.5 whitespace-nowrap">
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
                                className="px-2 py-1 rounded-md border border-slate-300 text-xs bg-white cursor-pointer"
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

                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <StatusBadge banned={u.banned} />
                          </td>

                          <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap tabular-nums text-xs">
                            {formatDate(u.created_at)}
                          </td>

                          <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap tabular-nums text-xs">
                            {formatDate(u.last_sign_in_at)}
                          </td>

                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex gap-2 items-center">
                              {!u.banned && roleChanged && (
                                <Button
                                  size="sm"
                                  onClick={() => handleSaveRole(u.id)}
                                  disabled={isSaving}
                                  className="h-7 px-2.5 text-xs bg-blue-500 hover:bg-blue-600 text-white font-semibold disabled:bg-blue-300"
                                >
                                  {isSaving ? "Saving…" : "Save Role"}
                                </Button>
                              )}

                              {!u.banned && !isSelf && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    handleDeactivate(u.id, u.email)
                                  }
                                  disabled={isDeactivating}
                                  className="h-7 px-2.5 text-xs border-red-300 text-red-700 hover:bg-red-50 font-semibold disabled:opacity-50"
                                >
                                  {isDeactivating
                                    ? "Deactivating…"
                                    : "Deactivate"}
                                </Button>
                              )}

                              {u.banned && (
                                <span className="text-xs text-slate-400 italic">
                                  Disabled
                                </span>
                              )}

                              {isSelf && !u.banned && (
                                <span className="text-xs text-slate-400 italic">
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
          </CardContent>
        </Card>
      </div>
    </main>
  );
}