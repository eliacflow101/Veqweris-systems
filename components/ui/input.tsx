import React from "react";
import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`h-9 rounded-md border border-line/90 bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/15 ${className}`} {...props} />;
}

