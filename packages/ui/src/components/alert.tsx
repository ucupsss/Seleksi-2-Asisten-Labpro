import * as React from "react";
import { cn } from "../lib/utils.js";

export function Alert({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="alert"
      className={cn("rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive", className)}
      {...props}
    />
  );
}
