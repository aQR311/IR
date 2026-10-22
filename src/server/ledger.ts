import "server-only";
import type { InvestorStage } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { computeHoldings, holderTotal } from "@/lib/cap-math";
import { postedLedger } from "./captable";

export const LEDGER_LOCK = 7_331_002; // ghi sổ tuần tự: 2 giao dịch song song không thể cùng tiêu một số dư

/** Cập nhật trạng thái vòng đời NĐT theo số dư sau khi ghi sổ. */
export async function syncStages(tx: Tx, investorIds: string[], byId: string) {
  const holdings = computeHoldings(await postedLedger(tx));
  for (const id of new Set(investorIds)) {
    const inv = await tx.investor.findUnique({ where: { id }, select: { stage: true } });
    if (!inv) continue;
    const now = holderTotal(holdings.get(id));
    const everHeld = await tx.shareTransaction.count({ where: { status: "POSTED", toInvestorId: id } });
    let to: InvestorStage | null = null;
    if (now > 0n) {
      const soldSome = await tx.shareTransaction.count({ where: { status: "POSTED", fromInvestorId: id } });
      to = soldSome > 0 ? "PARTIAL_EXIT" : "SHAREHOLDER";
    } else if (everHeld > 0) {
      to = "EXITED";
    }
    if (to && to !== inv.stage) {
      await tx.investor.update({ where: { id }, data: { stage: to } });
      await tx.stageChange.create({ data: { investorId: id, from: inv.stage, to, byId, note: "Tự động theo sổ cái" } });
    }
  }
}
