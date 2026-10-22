import "server-only";
import { db } from "@/lib/db";
import { STAGE_GROUP } from "@/lib/format";

export const stageTone = (s: string) =>
  ({ prospect: "accent", holder: "ok", exited: "neutral", dropped: "warn" } as const)[STAGE_GROUP[s] ?? "prospect"];

export function irOwners() {
  return db.user.findMany({
    where: { kind: "INTERNAL", status: "ACTIVE", role: { in: ["EXEC", "IR_LEAD", "IR_STAFF"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
