import type { LucideIcon } from "lucide-react";

export type DetailRowTone = "success" | "warning" | "muted";

const TONE_DOTS: Record<DetailRowTone, string> = {
  success: "good",
  warning: "warn",
  muted: "muted",
};

export function DetailRow({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: DetailRowTone;
}) {
  return (
    <div className="details-row">
      <span className="detail-row-label"><Icon />{label}</span>
      {tone ? (
        <span className={`detail-row-status ${tone}`}>
          <span className={`fleet-status-dot ${TONE_DOTS[tone]}`} aria-hidden="true" />
          {value}
        </span>
      ) : (
        <span className="details-row-value">{value}</span>
      )}
    </div>
  );
}
