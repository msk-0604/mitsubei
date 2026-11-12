import { STATUS_LABELS, type EstimateStatus } from "../../../shared/types";
import { Badge } from "./ui";

const TONES = { draft: "slate", issued: "blue", won: "green", lost: "red" } as const;

export function StatusBadge({ status }: { status: EstimateStatus }) {
  return <Badge tone={TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}
