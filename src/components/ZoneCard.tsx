"use client";

/**
 * ZoneCard — Displays a single warehouse zone on the floor plan.
 *
 * Shows the zone's name, type, and current drum count. Applies distinct
 * color coding per zone type and renders a capacity warning indicator when
 * the zone is at or over capacity.
 *
 * Requirements: 8.4, 8.5
 */

import type { Location, LocationType } from "@/types";
import React from "react";

// ─── Color palette ────────────────────────────────────────────────────────────

/**
 * Maps each LocationType to a set of CSS color values used for the card.
 * Requirement 8.4: cold=blue, hazard=red, qc=yellow, production=orange, standard=grey
 */
const ZONE_COLORS: Record<
  LocationType,
  {
    background: string;
    border: string;
    badge: string;
    badgeText: string;
    text: string;
  }
> = {
  cold: {
    background: "#eff6ff", // blue-50
    border: "#3b82f6", // blue-500
    badge: "#3b82f6",
    badgeText: "#ffffff",
    text: "#1d4ed8", // blue-700
  },
  hazard: {
    background: "#fef2f2", // red-50
    border: "#ef4444", // red-500
    badge: "#ef4444",
    badgeText: "#ffffff",
    text: "#b91c1c", // red-700
  },
  qc: {
    background: "#fefce8", // yellow-50
    border: "#eab308", // yellow-500
    badge: "#eab308",
    badgeText: "#713f12", // yellow-900 for contrast
    text: "#854d0e", // yellow-800
  },
  production: {
    background: "#fff7ed", // orange-50
    border: "#f97316", // orange-500
    badge: "#f97316",
    badgeText: "#ffffff",
    text: "#c2410c", // orange-700
  },
  standard: {
    background: "#f9fafb", // gray-50
    border: "#9ca3af", // gray-400
    badge: "#6b7280", // gray-500
    badgeText: "#ffffff",
    text: "#374151", // gray-700
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true when the zone is at or over capacity.
 * Requirement 8.5: warn when current_count >= capacity AND capacity > 0.
 */
function isAtCapacity(location: Location): boolean {
  return location.capacity > 0 && location.current_count >= location.capacity;
}

/** Human-readable label for each zone type. */
const TYPE_LABELS: Record<LocationType, string> = {
  cold: "Cold Storage",
  hazard: "Hazard",
  qc: "QC",
  production: "Production",
  standard: "Standard",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface CapacityWarningProps {
  current: number;
  capacity: number;
}

/**
 * Visual capacity warning badge shown when a zone is full.
 * Requirement 8.5.
 */
function CapacityWarning({ current, capacity }: CapacityWarningProps) {
  return (
    <div
      role="alert"
      aria-label={`Zone at capacity: ${current} of ${capacity} drums`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        marginTop: 8,
        padding: "4px 8px",
        backgroundColor: "#fef2f2",
        border: "1px solid #fca5a5",
        borderRadius: 6,
        color: "#b91c1c",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {/* Warning triangle icon */}
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      At capacity
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ZoneCardProps {
  /** The location/zone data to display. */
  location: Location;

  /**
   * Optional click handler — called when the user taps or clicks the card.
   * Used by the floor plan page to show the zone's item list (Requirement 8.3).
   */
  onClick?: (location: Location) => void;

  /** Optional CSS class applied to the outer container. */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ZoneCard renders a single warehouse zone tile for the floor plan view.
 *
 * @example
 * ```tsx
 * <ZoneCard
 *   location={zone}
 *   onClick={(loc) => setSelectedZone(loc)}
 * />
 * ```
 */
export function ZoneCard({ location, onClick, className }: ZoneCardProps) {
  const colors = ZONE_COLORS[location.type];
  const atCapacity = isAtCapacity(location);
  const isClickable = typeof onClick === "function";

  const handleClick = () => {
    if (isClickable) onClick(location);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isClickable && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick(location);
    }
  };

  return (
    <div
      className={className}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={
        isClickable
          ? `${location.name} zone — ${location.current_count} drums. Click to view items.`
          : `${location.name} zone — ${location.current_count} drums`
      }
      onClick={isClickable ? handleClick : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "16px",
        backgroundColor: colors.background,
        border: `2px solid ${atCapacity ? "#ef4444" : colors.border}`,
        borderRadius: 12,
        cursor: isClickable ? "pointer" : "default",
        transition: "box-shadow 0.15s ease, transform 0.1s ease",
        outline: "none",
        userSelect: "none",
        minWidth: 160,
      }}
      onMouseEnter={(e) => {
        if (isClickable) {
          (e.currentTarget as HTMLDivElement).style.boxShadow =
            "0 4px 12px rgba(0,0,0,0.12)";
          (e.currentTarget as HTMLDivElement).style.transform =
            "translateY(-1px)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
        (e.currentTarget as HTMLDivElement).style.transform = "none";
      }}
    >
      {/* Header row: zone type badge + zone ID */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        {/* Zone type badge */}
        <span
          aria-label={`Zone type: ${TYPE_LABELS[location.type]}`}
          style={{
            display: "inline-block",
            padding: "2px 8px",
            backgroundColor: colors.badge,
            color: colors.badgeText,
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {TYPE_LABELS[location.type]}
        </span>

        {/* Zone ID (small, muted) */}
        <span
          aria-label={`Zone ID: ${location.zone_id}`}
          style={{
            fontSize: 11,
            color: "#9ca3af",
            fontFamily: "monospace",
          }}
        >
          {location.zone_id}
        </span>
      </div>

      {/* Zone name */}
      <h3
        style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 700,
          color: colors.text,
          lineHeight: 1.3,
        }}
      >
        {location.name}
      </h3>

      {/* Drum count */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          marginTop: 10,
        }}
      >
        <span
          aria-label={`Current drum count: ${location.current_count}`}
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: atCapacity ? "#ef4444" : colors.text,
            lineHeight: 1,
          }}
        >
          {location.current_count}
        </span>
        {location.capacity > 0 && (
          <span
            aria-label={`Capacity: ${location.capacity}`}
            style={{
              fontSize: 14,
              color: "#9ca3af",
              fontWeight: 500,
            }}
          >
            / {location.capacity}
          </span>
        )}
        <span
          style={{
            fontSize: 13,
            color: "#6b7280",
            marginLeft: 2,
          }}
        >
          {location.current_count === 1 ? "drum" : "drums"}
        </span>
      </div>

      {/* Capacity warning — Requirement 8.5 */}
      {atCapacity && (
        <CapacityWarning
          current={location.current_count}
          capacity={location.capacity}
        />
      )}
    </div>
  );
}

export default ZoneCard;
