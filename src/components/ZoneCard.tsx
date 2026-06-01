"use client";

import type { Location, LocationType } from "@/types";
import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

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
    background: "#eff6ff",
    border: "#3b82f6",
    badge: "#3b82f6",
    badgeText: "#ffffff",
    text: "#1d4ed8",
  },
  hazard: {
    background: "#fef2f2",
    border: "#ef4444",
    badge: "#ef4444",
    badgeText: "#ffffff",
    text: "#b91c1c",
  },
  qc: {
    background: "#fefce8",
    border: "#eab308",
    badge: "#eab308",
    badgeText: "#713f12",
    text: "#854d0e",
  },
  production: {
    background: "#fff7ed",
    border: "#f97316",
    badge: "#f97316",
    badgeText: "#ffffff",
    text: "#c2410c",
  },
  standard: {
    background: "#f9fafb",
    border: "#9ca3af",
    badge: "#6b7280",
    badgeText: "#ffffff",
    text: "#374151",
  },
};

function isAtCapacity(location: Location): boolean {
  return location.capacity > 0 && location.current_count >= location.capacity;
}

const TYPE_LABELS: Record<LocationType, string> = {
  cold: "Cold Storage",
  hazard: "Hazard",
  qc: "QC",
  production: "Production",
  standard: "Standard",
};

interface CapacityWarningProps {
  current: number;
  capacity: number;
}

function CapacityWarning({ current, capacity }: CapacityWarningProps) {
  return (
    <div
      role="alert"
      aria-label={`Zone at capacity: ${current} of ${capacity} drums`}
      className="flex items-center gap-1 mt-2 px-2 py-1 bg-red-50 border border-red-200 rounded-md text-red-700 text-xs font-semibold"
    >
      <AlertTriangle className="size-3.5" />
      At capacity
    </div>
  );
}

export interface ZoneCardProps {
  location: Location;
  onClick?: (location: Location) => void;
  className?: string;
}

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
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={
        isClickable
          ? `${location.name} zone — ${location.current_count} drums. Click to view items.`
          : `${location.name} zone — ${location.current_count} drums`
      }
      onClick={isClickable ? handleClick : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      className={cn(
        "flex flex-col p-4 rounded-xl cursor-default select-none transition-shadow hover:shadow-md hover:-translate-y-0.5",
        isClickable && "cursor-pointer",
        className
      )}
      style={{
        backgroundColor: colors.background,
        border: `2px solid ${atCapacity ? "#ef4444" : colors.border}`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider"
          style={{
            backgroundColor: colors.badge,
            color: colors.badgeText,
          }}
        >
          {TYPE_LABELS[location.type]}
        </span>

        <span
          className="text-[11px] text-gray-400 font-mono"
          aria-label={`Zone ID: ${location.zone_id}`}
        >
          {location.zone_id}
        </span>
      </div>

      <h3
        className="text-base font-bold leading-tight m-0"
        style={{ color: colors.text }}
      >
        {location.name}
      </h3>

      <div className="flex items-baseline gap-1 mt-2.5">
        <span
          className="text-[28px] font-extrabold leading-none"
          style={{ color: atCapacity ? "#ef4444" : colors.text }}
          aria-label={`Current drum count: ${location.current_count}`}
        >
          {location.current_count}
        </span>
        {location.capacity > 0 && (
          <span
            className="text-sm text-gray-400 font-medium"
            aria-label={`Capacity: ${location.capacity}`}
          >
            / {location.capacity}
          </span>
        )}
        <span className="text-[13px] text-gray-500 ml-0.5">
          {location.current_count === 1 ? "drum" : "drums"}
        </span>
      </div>

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