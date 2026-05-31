"use client";

/**
 * QrScanner — Camera-based QR code scanner component for Scan Mode.
 *
 * Uses @zxing/browser to keep the camera open continuously. Each successful
 * decode calls the `onScan(lot_id)` callback. Displays a result overlay
 * (green check on success, red alert on error) within 500 ms of the server
 * response, and plays an audio beep on success or a distinct alert on error.
 *
 * Requirements: 6.1, 6.2, 6.3
 */

import { BrowserMultiFormatReader } from "@zxing/browser";
import { NotFoundException } from "@zxing/library";
import React, { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScanResultStatus = "idle" | "success" | "error";

export interface QrScannerProps {
  /**
   * Called with the decoded lot_id string on every successful QR decode.
   * The parent is responsible for submitting the scan to the server and
   * calling `reportResult` with the outcome.
   */
  onScan: (lotId: string) => void;

  /**
   * Whether the scanner is active. When false the camera stream is stopped.
   * Defaults to true.
   */
  active?: boolean;

  /**
   * Optional CSS class applied to the outer container.
   */
  className?: string;
}

// ─── Audio helpers ────────────────────────────────────────────────────────────

/**
 * Synthesises a short beep using the Web Audio API.
 * Falls back silently if the API is unavailable (e.g., SSR, test env).
 */
function playSuccessBeep(): void {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, ctx.currentTime); // A5
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);

    oscillator.onended = () => ctx.close();
  } catch {
    // Web Audio API not available — silently ignore
  }
}

/**
 * Synthesises a two-tone descending alert using the Web Audio API.
 * Falls back silently if the API is unavailable.
 */
function playErrorAlert(): void {
  try {
    const ctx = new AudioContext();

    const playTone = (freq: number, startTime: number, duration: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };

    playTone(440, ctx.currentTime, 0.2); // A4
    playTone(330, ctx.currentTime + 0.22, 0.2); // E4

    setTimeout(() => ctx.close(), 600);
  } catch {
    // Web Audio API not available — silently ignore
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * QrScanner keeps the camera open and continuously decodes QR codes.
 *
 * The parent controls the scan lifecycle:
 * 1. QrScanner decodes a QR → calls `onScan(lot_id)`
 * 2. Parent submits to server → calls the returned `reportResult` function
 * 3. QrScanner shows overlay + plays audio, then resumes scanning
 *
 * To report a result from outside, use the imperative handle exposed via
 * `QrScannerHandle` (see `useImperativeHandle` below), or pass a
 * `resultRef` prop.
 */

export interface QrScannerHandle {
  /** Report the server response for the most recent scan. */
  reportResult: (success: boolean, errorMessage?: string) => void;
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

interface OverlayProps {
  status: ScanResultStatus;
  errorMessage?: string;
}

function ScanOverlay({ status, errorMessage }: OverlayProps) {
  if (status === "idle") return null;

  const isSuccess = status === "success";

  return (
    <div
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: isSuccess
          ? "rgba(22, 163, 74, 0.85)"
          : "rgba(220, 38, 38, 0.85)",
        color: "#fff",
        zIndex: 10,
        borderRadius: "inherit",
        transition: "opacity 0.15s ease",
      }}
    >
      {isSuccess ? (
        <>
          {/* Green check icon */}
          <svg
            aria-hidden="true"
            width="72"
            height="72"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="9 12 11 14 15 10" />
          </svg>
          <span style={{ marginTop: 12, fontSize: 18, fontWeight: 600 }}>
            Scan accepted
          </span>
        </>
      ) : (
        <>
          {/* Red alert icon */}
          <svg
            aria-hidden="true"
            width="72"
            height="72"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{ marginTop: 12, fontSize: 18, fontWeight: 600 }}>
            Scan failed
          </span>
          {errorMessage && (
            <span
              style={{
                marginTop: 6,
                fontSize: 14,
                maxWidth: "80%",
                textAlign: "center",
                opacity: 0.9,
              }}
            >
              {errorMessage}
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * QrScanner component.
 *
 * @example
 * ```tsx
 * const scannerRef = useRef<QrScannerHandle>(null);
 *
 * async function handleScan(lotId: string) {
 *   const result = await submitScanToServer(lotId);
 *   scannerRef.current?.reportResult(result.success, result.error);
 * }
 *
 * <QrScanner ref={scannerRef} onScan={handleScan} />
 * ```
 */
const QrScanner = React.forwardRef<QrScannerHandle, QrScannerProps>(
  function QrScanner({ onScan, active = true, className }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const readerRef = useRef<BrowserMultiFormatReader | null>(null);
    const scanningRef = useRef(false); // prevents concurrent decode callbacks
    const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [overlayStatus, setOverlayStatus] =
      useState<ScanResultStatus>("idle");
    const [overlayError, setOverlayError] = useState<string | undefined>(
      undefined,
    );
    const [cameraError, setCameraError] = useState<string | null>(null);

    // ── Overlay management ──────────────────────────────────────────────────

    const clearOverlayTimer = useCallback(() => {
      if (overlayTimerRef.current !== null) {
        clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
    }, []);

    const showOverlay = useCallback(
      (status: "success" | "error", errorMessage?: string) => {
        clearOverlayTimer();
        setOverlayStatus(status);
        setOverlayError(errorMessage);

        // Auto-dismiss overlay after 1.5 s and re-enable scanning
        overlayTimerRef.current = setTimeout(() => {
          setOverlayStatus("idle");
          setOverlayError(undefined);
          scanningRef.current = false; // allow next scan
        }, 1500);
      },
      [clearOverlayTimer],
    );

    // ── Imperative handle exposed to parent ─────────────────────────────────

    React.useImperativeHandle(
      ref,
      () => ({
        reportResult(success: boolean, errorMessage?: string) {
          if (success) {
            playSuccessBeep();
            showOverlay("success");
          } else {
            playErrorAlert();
            showOverlay("error", errorMessage);
          }
        },
      }),
      [showOverlay],
    );

    // ── Camera / decoder lifecycle ──────────────────────────────────────────

    const stopCamera = useCallback(() => {
      if (readerRef.current) {
        try {
          BrowserMultiFormatReader.releaseAllStreams();
        } catch {
          // ignore cleanup errors
        }
        readerRef.current = null;
      }
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    }, []);

    const startCamera = useCallback(async () => {
      if (!videoRef.current) return;

      setCameraError(null);

      try {
        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;

        // Enumerate cameras and prefer the rear-facing one on mobile
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        const deviceId =
          devices.find(
            (d) =>
              d.label.toLowerCase().includes("back") ||
              d.label.toLowerCase().includes("rear") ||
              d.label.toLowerCase().includes("environment"),
          )?.deviceId ??
          devices[0]?.deviceId ??
          undefined;

        await reader.decodeFromVideoDevice(
          deviceId,
          videoRef.current,
          (result, error) => {
            if (result && !scanningRef.current) {
              // Lock to prevent duplicate callbacks for the same physical scan
              scanningRef.current = true;

              const text = result.getText();
              // Only forward values that look like a Lot ID or are non-empty
              if (text && text.trim().length > 0) {
                onScan(text.trim());
              } else {
                // Empty decode — release lock immediately
                scanningRef.current = false;
              }
            }

            // NotFoundException is the normal "no QR in frame" signal — ignore it
            if (error && !(error instanceof NotFoundException)) {
              console.warn("[QrScanner] decode error:", error);
            }
          },
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Camera access denied";
        setCameraError(message);
        console.error("[QrScanner] camera start error:", err);
      }
    }, [onScan]);

    // Start/stop camera based on `active` prop
    useEffect(() => {
      if (active) {
        startCamera();
      } else {
        stopCamera();
      }

      return () => {
        stopCamera();
        clearOverlayTimer();
      };
    }, [active, startCamera, stopCamera, clearOverlayTimer]);

    // ── Render ──────────────────────────────────────────────────────────────

    return (
      <div
        className={className}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 480,
          aspectRatio: "1 / 1",
          overflow: "hidden",
          borderRadius: 12,
          backgroundColor: "#000",
        }}
        aria-label="QR code scanner"
        role="region"
      >
        {/* Camera feed */}
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          aria-hidden="true"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />

        {/* Scan-frame guide */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "15%",
            border: "3px solid rgba(255,255,255,0.7)",
            borderRadius: 8,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
            pointerEvents: "none",
          }}
        />

        {/* Result overlay */}
        <ScanOverlay status={overlayStatus} errorMessage={overlayError} />

        {/* Camera error state */}
        {cameraError && (
          <div
            role="alert"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(0,0,0,0.8)",
              color: "#fff",
              padding: 24,
              textAlign: "center",
              gap: 8,
            }}
          >
            <svg
              aria-hidden="true"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
            <span style={{ fontWeight: 600 }}>Camera unavailable</span>
            <span style={{ fontSize: 13, opacity: 0.8 }}>{cameraError}</span>
          </div>
        )}
      </div>
    );
  },
);

QrScanner.displayName = "QrScanner";

export default QrScanner;
export { QrScanner };
