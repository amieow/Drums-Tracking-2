"use client";

import NavBar from "@/components/NavBar";
import { useAuth } from "@/lib/auth-context";
import type { ApiError, ApiSuccess, RegisterItemResponse } from "@/types";
import { useState } from "react";
import { CheckCircle2, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function todayIso(): string {
  // UTC+7 (WIB) — extract calendar date by constructing the date directly
  // from UTC+7 wall-clock components. JavaScript's Date(y,m,d) interprets
  // arguments as local (UTC+7) time and converts to UTC internally, so
  // midnight UTC+7 stays as its own calendar day regardless of the UTC date.
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();
  const dd = now.getDate();
  // Asia/Jakarta is UTC+7 with no DST
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(yyyy, mm, dd));
}

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

      const apiError = json as ApiError;
      if (
        apiError.error.code === "VALIDATION_ERROR" &&
        apiError.error.details
      ) {
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
    <Card className="w-full max-w-md bg-slate-800 border-slate-700 shadow-xl">
      <CardHeader className="pb-6">
        <CardTitle className="text-slate-100 text-2xl font-bold tracking-tight">
          Register New Drum
        </CardTitle>
        <p className="text-sm text-slate-400 mt-1">
          Enter the drum details to generate a Lot ID and QR code label.
        </p>
      </CardHeader>
      <CardContent className="px-8 pb-8">
        {errors.general && (
          <div
            role="alert"
            className="mb-5 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400"
          >
            {errors.general}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          noValidate
          aria-label="Item registration form"
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label
              htmlFor="material_type"
              className="text-xs font-semibold text-slate-400 uppercase tracking-wider"
            >
              Material Type
            </Label>
            <Input
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
              className="bg-slate-900 border-slate-600 text-slate-100 placeholder:text-slate-500"
            />
            {errors.material_type && (
              <p
                id="material_type-error"
                role="alert"
                className="text-xs text-red-400 mt-1"
              >
                {errors.material_type}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="supplier"
              className="text-xs font-semibold text-slate-400 uppercase tracking-wider"
            >
              Supplier
            </Label>
            <Input
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
              className="bg-slate-900 border-slate-600 text-slate-100 placeholder:text-slate-500"
            />
            {errors.supplier && (
              <p
                id="supplier-error"
                role="alert"
                className="text-xs text-red-400 mt-1"
              >
                {errors.supplier}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="intake_date"
              className="text-xs font-semibold text-slate-400 uppercase tracking-wider"
            >
              Intake Date
            </Label>
            <Input
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
              className="bg-slate-900 border-slate-600 text-slate-100"
            />
            {errors.intake_date && (
              <p
                id="intake_date-error"
                role="alert"
                className="text-xs text-red-400 mt-1"
              >
                {errors.intake_date}
              </p>
            )}
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-blue-500 hover:bg-blue-600 text-white font-bold disabled:bg-slate-600 disabled:text-slate-400"
          >
            {loading ? "Registering…" : "Register Drum"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface SuccessViewProps {
  result: RegisterItemResponse;
  onRegisterAnother: () => void;
}

function SuccessView({ result, onRegisterAnother }: SuccessViewProps) {
  const [printed, setPrinted] = useState(false);

  const createdAt = new Date(result.created_at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const dateLabel = new Date(result.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  async function handleDownload() {
    const res = await fetch(result.qr_code);
    const blob = await res.blob();
    const qrDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });

    const qrImg = new Image();
    qrImg.src = qrDataUrl;
    await new Promise<void>((resolve) => {
      qrImg.onload = () => resolve();
    });

    const padding = 24;
    const qrSize = 200;
    const lotFontSize = 18;
    const dateFontSize = 13;
    const gap = 10;
    const canvasWidth = qrSize + padding * 2;
    const canvasHeight =
      padding + qrSize + gap + lotFontSize + gap + dateFontSize + padding;

    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.drawImage(qrImg, padding, padding, qrSize, qrSize);

    ctx.fillStyle = "#0f172a";
    ctx.font = `800 ${lotFontSize}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(
      result.lot_id,
      canvasWidth / 2,
      padding + qrSize + gap + lotFontSize,
    );

    ctx.fillStyle = "#475569";
    ctx.font = `500 ${dateFontSize}px system-ui, sans-serif`;
    ctx.fillText(
      dateLabel,
      canvasWidth / 2,
      padding + qrSize + gap + lotFontSize + gap + dateFontSize,
    );

    const link = document.createElement("a");
    link.download = `${result.lot_id}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  async function handlePrint() {
    const res = await fetch(result.qr_code);
    const blob = await res.blob();
    const qrDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });

    const printWindow = window.open("", "_blank", "width=400,height=500");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Label — ${result.lot_id}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              background: #fff;
              font-family: system-ui, sans-serif;
            }
            .label {
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 10px;
              padding: 24px;
              border: 1px solid #e2e8f0;
              border-radius: 12px;
              width: 260px;
            }
            img { width: 200px; height: 200px; display: block; }
            .lot { font-family: monospace; font-size: 18px; font-weight: 800; color: #0f172a; letter-spacing: 0.06em; text-align: center; }
            .date { font-size: 13px; color: #475569; font-weight: 500; text-align: center; }
            @media print {
              body { min-height: unset; }
              .label { border: none; }
            }
          </style>
        </head>
        <body>
          <div class="label">
            <img src="${qrDataUrl}" alt="QR code for ${result.lot_id}" />
            <div class="lot">${result.lot_id}</div>
            <div class="date">${dateLabel}</div>
          </div>
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
    setPrinted(true);
  }

  return (
    <Card
      className="w-full max-w-md bg-slate-800 border-slate-700 shadow-xl text-center"
      role="region"
      aria-label="Registration successful"
    >
      <CardContent className="pt-8 pb-6 px-8">
        <div
          className="size-14 rounded-full bg-green-500/15 flex items-center justify-center mx-auto mb-4"
          aria-hidden="true"
        >
          <CheckCircle2 className="size-7 text-green-500" />
        </div>

        <h1 className="text-xl font-bold text-slate-100 mb-1.5">
          Drum Registered
        </h1>
        <p className="text-sm text-slate-400 mb-6">
          The drum has been assigned a unique Lot ID and is ready for labelling.
        </p>

        <div className="bg-slate-900 rounded-lg p-4 mb-4 border border-slate-700">
          <div className="text-[11px] text-slate-500 uppercase tracking-widest mb-1">
            Lot ID
          </div>
          <div
            className="text-2xl font-bold font-mono text-sky-400 tracking-wider"
            aria-label={`Lot ID: ${result.lot_id}`}
          >
            {result.lot_id}
          </div>
        </div>

        <div className="flex justify-between text-xs text-slate-500 mb-6 gap-2">
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-[10px] uppercase tracking-wider">Status</span>
            <span className="text-slate-300 font-medium">{result.current_status}</span>
          </div>
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-[10px] uppercase tracking-wider">Location</span>
            <span className="text-slate-300 font-medium">{result.location_zone}</span>
          </div>
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-[10px] uppercase tracking-wider">Registered</span>
            <span className="text-slate-300 font-medium">{createdAt}</span>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3 mb-6">
          <span className="text-[12px] text-slate-500 uppercase tracking-wider">
            QR Code Label
          </span>

          <div className="bg-white rounded-xl p-4 flex flex-col items-center gap-3 shadow-lg">
            <img
              src={result.qr_code}
              alt={`QR code for drum ${result.lot_id}`}
              className="size-48 rounded-lg"
              width={200}
              height={200}
            />
            <div className="font-mono font-extrabold text-slate-900 text-lg tracking-wider">
              {result.lot_id}
            </div>
            <div className="text-xs text-slate-500 font-medium">
              {new Date(result.created_at).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </div>
          </div>

          <button
            onClick={() => void handleDownload()}
            className="text-sm text-sky-400 hover:text-sky-300 underline bg-none border-none cursor-pointer p-0"
            aria-label={`Download label for ${result.lot_id}`}
          >
            Download Label PNG
          </button>
        </div>

        <Button
          onClick={() => void handlePrint()}
          className="w-full mb-3 bg-blue-700 hover:bg-blue-600 text-white font-bold border-blue-500"
          aria-label={printed ? "Try print again" : "Print label"}
        >
          <Printer className="size-4 mr-2" />
          {printed ? "Try Print Again" : "Print Label"}
        </Button>

        {printed && (
          <Button
            variant="outline"
            onClick={onRegisterAnother}
            className="w-full border-slate-600 text-slate-300 hover:bg-slate-700"
          >
            Register Another Drum
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

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
    <main
      className="min-h-dvh bg-slate-900 text-slate-100 flex flex-col items-center px-5 py-8 pb-16"
      aria-label="Item registration"
    >
      <NavBar title="Register Drum" />
      <div className="mt-8 w-full max-w-md">
        {result ? (
          <SuccessView
            result={result}
            onRegisterAnother={handleRegisterAnother}
          />
        ) : (
          <RegistrationForm token={token} onSuccess={handleSuccess} />
        )}
      </div>
    </main>
  );
}