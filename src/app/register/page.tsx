"use client";

/**
 * Item Registration Page — `/register`
 *
 * Provides a form for operators to register a new drum into the system.
 * On successful submission the page displays the generated Lot ID and
 * an inline QR code image so the operator can immediately print the label.
 *
 * Requirements: 3.1, 3.7, 15.1, 15.2
 */

import { useAuth } from "@/lib/auth-context";
import type { ApiError, ApiSuccess, RegisterItemResponse } from "@/types";
import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormState {
  material_type: string;
  supplier: string;
  intake_date: string;
}

interface FieldErrors {
  material_type?: string;
  supplier?: string;
  intake_date?: string;
  general?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns today's date as a YYYY-MM-DD string (local time). */
function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: "100dvh",
    backgroundColor: "#0f172a",
    color: "#f1f5f9",
    fontFamily: "system-ui, -apple-system, sans-serif",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    padding: "32px 20px 48px",
  },
  card: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: "28px 28px 32px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
  },
  heading: {
    fontSize: 22,
    fontWeight: 700,
    margin: "0 0 6px",
    letterSpacing: "-0.01em",
  },
  subheading: {
    fontSize: 14,
    color: "#94a3b8",
    margin: "0 0 28px",
  },
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#94a3b8",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    marginBottom: 6,
  },
  input: (hasError: boolean) => ({
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: `1px solid ${hasError ? "#ef4444" : "rgba(255,255,255,0.15)"}`,
    backgroundColor: "#0f172a",
    color: "#f1f5f9",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box" as const,
    transition: "border-color 0.15s",
  }),
  fieldError: {
    marginTop: 5,
    fontSize: 12,
    color: "#f87171",
  },
  generalError: {
    backgroundColor: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.4)",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#fca5a5",
    marginBottom: 20,
  },
  submitBtn: (loading: boolean) => ({
    width: "100%",
    padding: "12px 0",
    borderRadius: 10,
    border: "none",
    backgroundColor: loading ? "#334155" : "#3b82f6",
    color: loading ? "#64748b" : "#fff",
    fontWeight: 700,
    fontSize: 15,
    cursor: loading ? "not-allowed" : "pointer",
    transition: "background-color 0.15s",
    marginTop: 8,
  }),
  // ── Success card ──────────────────────────────────────────────────────────
  successCard: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: "28px 28px 32px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    textAlign: "center" as const,
  },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    backgroundColor: "rgba(34,197,94,0.15)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 16px",
  },
  successHeading: {
    fontSize: 20,
    fontWeight: 700,
    margin: "0 0 6px",
  },
  successSub: {
    fontSize: 14,
    color: "#94a3b8",
    margin: "0 0 24px",
  },
  lotIdBox: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    padding: "14px 18px",
    marginBottom: 24,
    border: "1px solid rgba(255,255,255,0.08)",
  },
  lotIdLabel: {
    fontSize: 11,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginBottom: 4,
  },
  lotIdValue: {
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "#38bdf8",
    fontVariantNumeric: "tabular-nums",
  },
  qrWrapper: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 10,
    marginBottom: 28,
  },
  qrLabel: {
    fontSize: 12,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  },
  qrImage: {
    width: 200,
    height: 200,
    borderRadius: 10,
    backgroundColor: "#fff",
    padding: 8,
    display: "block",
  },
  registerAnotherBtn: {
    width: "100%",
    padding: "12px 0",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    backgroundColor: "transparent",
    color: "#f1f5f9",
    fontWeight: 600,
    fontSize: 15,
    cursor: "pointer",
  },
  metaRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    color: "#64748b",
    marginBottom: 20,
    gap: 8,
  },
  metaItem: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-start" as const,
    gap: 2,
  },
  metaLabel: {
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    fontSize: 10,
  },
  metaValue: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: 500,
  },
} as const;

// ─── Registration Form ────────────────────────────────────────────────────────

interface RegistrationFormProps {
  token: string | null;
  onSuccess: (result: RegisterItemResponse) => void;
}

function RegistrationForm({ token, onSuccess }: RegistrationFormProps) {
  const [form, setForm] = useState<FormState>({
    material_type: "",
    supplier: "",
    intake_date: todayIso(),
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    // Clear field error on change
    if (errors[name as keyof FieldErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    setLoading(true);

    try {
      const response = await fetch("/api/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          material_type: form.material_type.trim(),
          supplier: form.supplier.trim(),
          intake_date: form.intake_date,
        }),
      });

      const json = (await response.json()) as
        | ApiSuccess<RegisterItemResponse>
        | ApiError;

      if (json.success) {
        onSuccess(json.data);
        return;
      }

      // Handle error response
      const apiError = json as ApiError;
      if (
        apiError.error.code === "VALIDATION_ERROR" &&
        apiError.error.details
      ) {
        // Map field-level details to form errors
        const fieldErrors: FieldErrors = {};
        for (const [field, message] of Object.entries(apiError.error.details)) {
          fieldErrors[field as keyof FieldErrors] = message;
        }
        setErrors(fieldErrors);
      } else if (apiError.error.code === "UNAUTHORIZED") {
        setErrors({
          general: "You must be logged in to register items.",
        });
      } else if (apiError.error.code === "FORBIDDEN") {
        setErrors({
          general: "You do not have permission to register items.",
        });
      } else {
        setErrors({
          general: apiError.error.message ?? "An unexpected error occurred.",
        });
      }
    } catch {
      setErrors({
        general: "Network error — please check your connection and try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.card}>
      <h1 style={styles.heading}>Register New Drum</h1>
      <p style={styles.subheading}>
        Enter the drum details to generate a Lot ID and QR code label.
      </p>

      {errors.general && (
        <div role="alert" style={styles.generalError}>
          {errors.general}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        noValidate
        aria-label="Item registration form"
      >
        {/* Material Type */}
        <div style={styles.fieldGroup}>
          <label htmlFor="material_type" style={styles.label}>
            Material Type
          </label>
          <input
            id="material_type"
            name="material_type"
            type="text"
            value={form.material_type}
            onChange={handleChange}
            placeholder="e.g. Citrus Extract"
            maxLength={100}
            required
            aria-required="true"
            aria-describedby={
              errors.material_type ? "material_type-error" : undefined
            }
            aria-invalid={!!errors.material_type}
            style={styles.input(!!errors.material_type)}
            autoComplete="off"
          />
          {errors.material_type && (
            <p id="material_type-error" role="alert" style={styles.fieldError}>
              {errors.material_type}
            </p>
          )}
        </div>

        {/* Supplier */}
        <div style={styles.fieldGroup}>
          <label htmlFor="supplier" style={styles.label}>
            Supplier
          </label>
          <input
            id="supplier"
            name="supplier"
            type="text"
            value={form.supplier}
            onChange={handleChange}
            placeholder="e.g. PT Aroma Nusantara"
            maxLength={100}
            required
            aria-required="true"
            aria-describedby={errors.supplier ? "supplier-error" : undefined}
            aria-invalid={!!errors.supplier}
            style={styles.input(!!errors.supplier)}
            autoComplete="off"
          />
          {errors.supplier && (
            <p id="supplier-error" role="alert" style={styles.fieldError}>
              {errors.supplier}
            </p>
          )}
        </div>

        {/* Intake Date */}
        <div style={styles.fieldGroup}>
          <label htmlFor="intake_date" style={styles.label}>
            Intake Date
          </label>
          <input
            id="intake_date"
            name="intake_date"
            type="date"
            value={form.intake_date}
            onChange={handleChange}
            max={todayIso()}
            required
            aria-required="true"
            aria-describedby={
              errors.intake_date ? "intake_date-error" : undefined
            }
            aria-invalid={!!errors.intake_date}
            style={styles.input(!!errors.intake_date)}
          />
          {errors.intake_date && (
            <p id="intake_date-error" role="alert" style={styles.fieldError}>
              {errors.intake_date}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          style={styles.submitBtn(loading)}
        >
          {loading ? "Registering…" : "Register Drum"}
        </button>
      </form>
    </div>
  );
}

// ─── Success View ─────────────────────────────────────────────────────────────

interface SuccessViewProps {
  result: RegisterItemResponse;
  onRegisterAnother: () => void;
}

function SuccessView({ result, onRegisterAnother }: SuccessViewProps) {
  const createdAt = new Date(result.created_at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div
      style={styles.successCard}
      role="region"
      aria-label="Registration successful"
    >
      {/* Success icon */}
      <div style={styles.successIcon} aria-hidden="true">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#22c55e"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h1 style={styles.successHeading}>Drum Registered</h1>
      <p style={styles.successSub}>
        The drum has been assigned a unique Lot ID and is ready for labelling.
      </p>

      {/* Lot ID */}
      <div style={styles.lotIdBox}>
        <div style={styles.lotIdLabel}>Lot ID</div>
        <div style={styles.lotIdValue} aria-label={`Lot ID: ${result.lot_id}`}>
          {result.lot_id}
        </div>
      </div>

      {/* Metadata row */}
      <div style={styles.metaRow}>
        <div style={styles.metaItem}>
          <span style={styles.metaLabel}>Status</span>
          <span style={styles.metaValue}>{result.current_status}</span>
        </div>
        <div style={styles.metaItem}>
          <span style={styles.metaLabel}>Location</span>
          <span style={styles.metaValue}>{result.location_zone}</span>
        </div>
        <div style={styles.metaItem}>
          <span style={styles.metaLabel}>Registered</span>
          <span style={styles.metaValue}>{createdAt}</span>
        </div>
      </div>

      {/* QR Code image (Req 15.1, 15.2) */}
      <div style={styles.qrWrapper}>
        <span style={styles.qrLabel}>QR Code Label</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={result.qr_code}
          alt={`QR code for drum ${result.lot_id}`}
          style={styles.qrImage}
          width={200}
          height={200}
        />
        <a
          href={result.qr_code}
          download={`${result.lot_id}.png`}
          style={{
            fontSize: 13,
            color: "#38bdf8",
            textDecoration: "none",
          }}
          aria-label={`Download QR code for ${result.lot_id}`}
        >
          Download PNG
        </a>
      </div>

      <button
        style={styles.registerAnotherBtn}
        onClick={onRegisterAnother}
        aria-label="Register another drum"
      >
        Register Another Drum
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RegisterPage() {
  const [result, setResult] = useState<RegisterItemResponse | null>(null);
  const { token } = useAuth();

  function handleSuccess(data: RegisterItemResponse) {
    setResult(data);
  }

  function handleRegisterAnother() {
    setResult(null);
  }

  return (
    <main style={styles.page} aria-label="Item registration">
      {result ? (
        <SuccessView
          result={result}
          onRegisterAnother={handleRegisterAnother}
        />
      ) : (
        <RegistrationForm token={token} onSuccess={handleSuccess} />
      )}
    </main>
  );
}
