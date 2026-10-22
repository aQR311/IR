import type { Metadata } from "next";
import { requireInternal } from "@/lib/session";
import { ActionForm, Submit } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { createInvestorAction } from "@/server/actions/investors";
import { InvestorFields } from "../investor-fields";
import { irOwners } from "../shared";

export const metadata: Metadata = { title: "Thêm nhà đầu tư" };

export default async function NewInvestor() {
  await requireInternal("investors.edit");
  const owners = await irOwners();
  return (
    <>
      <PageHeader title="Thêm nhà đầu tư" subtitle="Thông tin KYC nhạy cảm (CCCD, tài khoản ngân hàng) nhập ở trang chi tiết sau khi tạo." />
      <Card className="max-w-3xl">
        <ActionForm action={createInvestorAction}>
          <InvestorFields owners={owners} withStage />
          <div className="mt-4"><Submit>Tạo hồ sơ</Submit></div>
        </ActionForm>
      </Card>
    </>
  );
}
