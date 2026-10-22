import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireInternal } from "@/lib/session";
import { fmtDateTime, fmtShares } from "@/lib/format";
import { ActionForm, Submit } from "@/components/action-form";
import { Card, Empty, PageHeader, TableWrap } from "@/components/ui";
import { cancelBatchAction, importInvestorsAction, importTxnsAction, postBatchAction } from "@/server/actions/import";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Nhập dữ liệu" };

export default async function ImportPage() {
  // Người nhập (data.import) và người duyệt lô (txn.post) đều dùng trang này.
  const u = await requireInternal();
  const canImport = can(u, "data.import");
  if (!canImport && !can(u, "txn.post")) redirect("/forbidden");
  const [batches, classCount] = await Promise.all([
    db.shareTransaction.groupBy({
      by: ["importBatch", "createdById"],
      where: { importBatch: { not: null }, status: "DRAFT" },
      _count: true,
      _sum: { quantity: true },
      _min: { createdAt: true },
    }),
    db.shareClass.count(),
  ]);
  const users = Object.fromEntries(
    (await db.user.findMany({ where: { id: { in: batches.map((b) => b.createdById) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]),
  );

  return (
    <>
      <PageHeader title="Nhập dữ liệu từ Excel" subtitle="Điền file mẫu trong Excel → Lưu thành “CSV UTF-8” → Kiểm tra → Nhập" />

      {canImport && classCount === 0 && (
        <p className="mb-4 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          Chưa có lớp cổ phần nào. Tạo lớp cổ phần (và vòng gọi vốn nếu cần) ở <Link href="/settings/equity" className="underline">Cấu hình vốn</Link> trước khi nhập giao dịch.
        </p>
      )}

      {canImport && <div className="grid gap-4 xl:grid-cols-2">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- route trả file CSV, không phải trang */}
        <Card title="1. Nhà đầu tư" actions={<a href="/api/templates/nha-dau-tu" className="text-xs text-accent">Tải file mẫu</a>}>
          <p className="mb-3 text-xs text-muted">Mỗi dòng một nhà đầu tư / cổ đông / nhân sự nhận ESOP. Trùng tên với hồ sơ đã có sẽ bị báo lỗi. Không nhập CCCD hay tài khoản ngân hàng qua file.</p>
          <ImportForm action={importInvestorsAction} />
        </Card>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- route trả file CSV, không phải trang */}
        <Card title="2. Giao dịch cổ phần" actions={<a href="/api/templates/giao-dich" className="text-xs text-accent">Tải file mẫu</a>}>
          <p className="mb-3 text-xs text-muted">
            Nhập lịch sử phát hành / chuyển nhượng / mua lại, hoặc chỉ số dư hiện tại (mỗi cổ đông một dòng PHAT_HANH). Hệ thống chạy thử toàn bộ file trên sổ cái và báo dòng nào làm âm cổ phần. Giao dịch vào sổ dưới dạng <b>lô nháp</b>, người khác duyệt mới được ghi sổ.
          </p>
          <ImportForm action={importTxnsAction} />
        </Card>
      </div>}

      <h2 className="mb-2 mt-6 text-sm font-semibold">Lô giao dịch chờ ghi sổ</h2>
      {batches.length === 0 ? <Card><Empty>Không có lô nào đang chờ.</Empty></Card> : (
        <TableWrap>
          <thead><tr><th>Lô</th><th>Người nhập</th><th>Thời gian</th><th className="text-right">Số GD</th><th className="text-right">Tổng CP</th><th /></tr></thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.importBatch}>
                <td className="font-mono text-xs"><Link href={`/transactions?status=DRAFT`} className="hover:underline">{b.importBatch}</Link></td>
                <td>{users[b.createdById] ?? "?"}</td>
                <td className="whitespace-nowrap text-muted">{fmtDateTime(b._min.createdAt)}</td>
                <td className="num text-right">{b._count}</td>
                <td className="num text-right">{fmtShares(b._sum.quantity)}</td>
                <td className="whitespace-nowrap">
                  <div className="flex gap-2">
                    {can(u, "txn.post") && b.createdById !== u.id && (
                      <ActionForm action={postBatchAction} confirm={`Ghi sổ cả lô ${b.importBatch}? Sau khi ghi sổ không thể sửa.`}>
                        <input type="hidden" name="batch" value={b.importBatch ?? ""} />
                        <Submit>Ghi sổ cả lô</Submit>
                      </ActionForm>
                    )}
                    {can(u, "txn.post") && b.createdById === u.id && <span className="text-xs text-muted">Chờ người khác duyệt</span>}
                    {can(u, "txn.create") && (
                      <ActionForm action={cancelBatchAction} confirm="Huỷ toàn bộ lô nháp này?">
                        <input type="hidden" name="batch" value={b.importBatch ?? ""} />
                        <Submit variant="btn-danger">Huỷ lô</Submit>
                      </ActionForm>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}
