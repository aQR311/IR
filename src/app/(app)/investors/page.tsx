import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireInternal } from "@/lib/session";
import { CATEGORY_LABEL, KYC_LABEL, STAGE_GROUP, STAGE_LABEL } from "@/lib/format";
import { Badge, Empty, PageHeader, TableWrap } from "@/components/ui";
import { stageTone } from "./shared";

export const metadata: Metadata = { title: "Nhà đầu tư" };

const GROUPS = [
  { key: "", label: "Tất cả" },
  { key: "prospect", label: "Tiềm năng" },
  { key: "holder", label: "Đang nắm giữ" },
  { key: "exited", label: "Đã exit" },
  { key: "dropped", label: "Dừng" },
] as const;

export default async function Investors({ searchParams }: PageProps<"/investors">) {
  const u = await requireInternal("investors.view");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 100) : "");
  const group = str("group");
  const stage = str("stage");
  const q = str("q");
  const category = str("category");

  const where: Prisma.InvestorWhereInput = {};
  if (stage && stage in STAGE_LABEL) where.stage = stage as Prisma.InvestorWhereInput["stage"];
  else if (group) {
    const stages = Object.keys(STAGE_GROUP).filter((s) => STAGE_GROUP[s] === group);
    where.stage = { in: stages as never };
  }
  if (category && category in CATEGORY_LABEL) where.category = category as never;
  if (str("kyc") === "missing") {
    where.stage = { in: ["SHAREHOLDER", "PARTIAL_EXIT"] };
    where.kycStatus = { not: "VERIFIED" };
  }
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }];

  const [list, counts] = await Promise.all([
    db.investor.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: 500,
      select: {
        id: true, code: true, name: true, type: true, category: true, stage: true, isForeign: true,
        country: true, kycStatus: true, irOwner: { select: { name: true } }, updatedAt: true,
      },
    }),
    db.investor.groupBy({ by: ["stage"], _count: true }),
  ]);
  const total = (g: string) =>
    counts.filter((c) => !g || STAGE_GROUP[c.stage] === g).reduce((a, c) => a + c._count, 0);

  return (
    <>
      <PageHeader
        title="Nhà đầu tư"
        subtitle="Hồ sơ nhà đầu tư tiềm năng, cổ đông hiện hữu và đã exit"
        actions={can(u, "investors.edit") && <Link href="/investors/new" className="btn">+ Thêm nhà đầu tư</Link>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {GROUPS.map((g) => (
          <Link
            key={g.key}
            href={g.key ? `/investors?group=${g.key}` : "/investors"}
            className={`rounded-full border px-3 py-1 text-xs ${
              group === g.key && !stage ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-ink"
            }`}
          >
            {g.label} · {total(g.key)}
          </Link>
        ))}
        <form className="ml-auto flex gap-2" action="/investors">
          {group && <input type="hidden" name="group" value={group} />}
          <input name="q" defaultValue={q} placeholder="Tìm tên / mã" className="field w-48" aria-label="Tìm kiếm" />
        </form>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th>Mã</th>
            <th>Tên</th>
            <th>Nhóm</th>
            <th>Trạng thái</th>
            <th>KYC</th>
            <th>Phụ trách IR</th>
          </tr>
        </thead>
        <tbody>
          {list.map((i) => (
            <tr key={i.id}>
              <td className="num whitespace-nowrap text-muted">{i.code}</td>
              <td>
                <Link href={`/investors/${i.id}`} className="font-medium hover:underline">{i.name}</Link>
                <div className="text-xs text-muted">
                  {i.type === "ORGANIZATION" ? "Tổ chức" : "Cá nhân"}
                  {i.isForeign && ` · Nước ngoài (${i.country})`}
                </div>
              </td>
              <td className="whitespace-nowrap">{CATEGORY_LABEL[i.category]}</td>
              <td><Badge tone={stageTone(i.stage)}>{STAGE_LABEL[i.stage]}</Badge></td>
              <td><Badge tone={i.kycStatus === "VERIFIED" ? "ok" : i.kycStatus === "REJECTED" ? "bad" : "neutral"}>{KYC_LABEL[i.kycStatus]}</Badge></td>
              <td className="whitespace-nowrap text-muted">{i.irOwner?.name ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {list.length === 0 && <Empty>Không có nhà đầu tư nào khớp bộ lọc.</Empty>}
    </>
  );
}
