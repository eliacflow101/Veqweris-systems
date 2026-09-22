import React from "react";
import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-md border border-line/80 bg-surface shadow-panel ${className}`} {...props} />;
}

