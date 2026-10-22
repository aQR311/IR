import "server-only";
import { env } from "./env";

export async function sendMail(to: string, subject: string, text: string) {
  const e = env();
  if (e.MAIL_DRIVER === "console") {
    // Chỉ dev (env() chặn driver này ở production).
    console.log(`\n[mail:dev] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${e.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: e.MAIL_FROM, to: [to], subject, text }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Gửi email lỗi ${res.status}`);
}
