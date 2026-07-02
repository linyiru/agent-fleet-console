import type { HTMLAttributes } from "react";
import { classNames } from "../../controllers/format.ts";

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive";

export function Badge({ className, variant = "default", ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return <span className={classNames("ui-badge", `ui-badge-${variant}`, className)} {...props} />;
}
