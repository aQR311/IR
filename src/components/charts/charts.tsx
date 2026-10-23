import type { ReactNode } from "react";
import { ChartTip } from "./chart-tip";

// Biểu đồ dựng bằng HTML/CSS thuần (render ở server, không thư viện ngoài, hợp CSP).
// Quy ước: màu theo thực thể (slot cố định), cột ≤ 24px, đầu dữ liệu bo 4px, khe 2px màu nền giữa các phần,
// lưới mảnh, chữ luôn dùng màu chữ (không dùng màu series), luôn có chú thích khi ≥ 2 series.

export type Series = { key: string; label: string; color: string };

const pctText = (n: number) => `${n.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;

export function Legend({ series, values }: { series: Series[]; values?: Record<string, ReactNode> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          <span className="text-muted">{s.label}</span>
          {values?.[s.key] !== undefined && <span className="num font-medium text-ink">{values[s.key]}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Một thanh ngang 100%: cơ cấu sở hữu. `parts` theo thứ tự series. */
export function ShareBar({
  series,
  parts,
  tipDetail,
}: {
  series: Series[];
  parts: Record<string, number>; // % (0–100)
  tipDetail?: Record<string, string>;
}) {
  const shown = series.filter((s) => (parts[s.key] ?? 0) > 0);
  return (
    <ChartTip>
      <div className="flex h-7 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label="Cơ cấu sở hữu">
        {shown.map((s) => (
          <div
            key={s.key}
            data-tip={`${s.label}|${pctText(parts[s.key])}${tipDetail?.[s.key] ? `|${tipDetail[s.key]}` : ""}`}
            className="h-full transition-opacity hover:opacity-80"
            style={{ width: `${parts[s.key]}%`, background: s.color, minWidth: 2 }}
          />
        ))}
      </div>
      <div className="mt-3">
        <Legend series={shown} values={Object.fromEntries(shown.map((s) => [s.key, pctText(parts[s.key])]))} />
      </div>
    </ChartTip>
  );
}

/** Cột chồng 100% theo mốc thời gian (vd: cơ cấu sở hữu sau từng vòng). */
export function StackedColumns({
  series,
  columns,
  height = 200,
}: {
  series: Series[];
  columns: { key: string; label: string; sub?: string; parts: Record<string, number> }[];
  height?: number;
}) {
  return (
    <ChartTip>
      <div className="flex gap-2">
        <Axis height={height} ticks={[100, 75, 50, 25, 0]} format={(t) => `${t}%`} />
        <div className="relative flex-1">
          <Grid height={height} lines={4} />
          <div className="relative flex items-end justify-around" style={{ height }}>
            {columns.map((c) => {
              const segs = series.filter((s) => (c.parts[s.key] ?? 0) > 0);
              return (
                <div key={c.key} className="flex h-full w-6 flex-col-reverse gap-[2px]" role="img" aria-label={c.label}>
                  {segs.map((s, i) => (
                    <div
                      key={s.key}
                      data-tip={`${c.label} · ${s.label}|${pctText(c.parts[s.key])}`}
                      className={`w-full hover:opacity-80 ${i === segs.length - 1 ? "rounded-t" : ""}`}
                      style={{ height: `calc(${c.parts[s.key]}% - 2px)`, background: s.color, minHeight: 1 }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <XLabels columns={columns} />
      <div className="mt-3"><Legend series={series} /></div>
    </ChartTip>
  );
}

/** Cột đơn (một series): giá trị in trên đỉnh cột. */
export function Columns({
  columns,
  height = 180,
  color = "var(--series-1)",
  format,
  tip,
}: {
  columns: { key: string; label: string; sub?: string; value: number }[];
  height?: number;
  color?: string;
  format: (v: number) => string;
  tip?: (c: { label: string; value: number }) => string;
}) {
  const max = Math.max(...columns.map((c) => c.value), 1);
  const top = niceMax(max * 1.15); // chừa khoảng trên đỉnh cột cao nhất cho nhãn giá trị
  return (
    <ChartTip>
      <div className="flex gap-2">
        <Axis height={height} ticks={[top, top * 0.75, top / 2, top / 4, 0]} format={format} />
        <div className="relative flex-1">
          <Grid height={height} lines={4} />
          <div className="relative flex items-end justify-around" style={{ height }}>
            {columns.map((c) => (
              <div key={c.key} className="flex h-full w-6 flex-col items-center justify-end">
                <span className="num mb-1 whitespace-nowrap text-[11px] font-medium">{format(c.value)}</span>
                <div
                  data-tip={tip ? tip(c) : `${c.label}|${format(c.value)}`}
                  className="w-full rounded-t hover:opacity-80"
                  style={{ height: `${(c.value / top) * 100}%`, background: color, minHeight: 2 }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <XLabels columns={columns} />
    </ChartTip>
  );
}

/** Phễu: thanh ngang theo giai đoạn, màu tuần tự một sắc độ (đậm dần theo độ tiến xa). */
export function Funnel({ stages }: { stages: { key: string; label: string; value: number; href?: string }[] }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  const ramp = ["var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)"];
  return (
    <ChartTip>
      <ul className="space-y-1.5">
        {stages.map((s, i) => (
          <li key={s.key} className="grid grid-cols-[110px_1fr] items-center gap-2 text-xs">
            {s.href ? <a href={s.href} className="truncate text-muted hover:text-ink">{s.label}</a> : <span className="truncate text-muted">{s.label}</span>}
            <div className="flex items-center gap-2">
              <div
                data-tip={`${s.label}|${s.value} nhà đầu tư`}
                className="h-4 rounded-r hover:opacity-80"
                style={{ width: `${(s.value / max) * 85}%`, minWidth: s.value ? 4 : 0, background: ramp[Math.min(ramp.length - 1, Math.floor((i / Math.max(1, stages.length - 1)) * (ramp.length - 1)))] }}
              />
              <span className="num font-medium">{s.value}</span>
            </div>
          </li>
        ))}
      </ul>
    </ChartTip>
  );
}

/** Thanh tỷ lệ nhỏ trong ô bảng. */
export function InlineBar({ pct, color = "var(--series-1)" }: { pct: number; color?: string }) {
  return (
    <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-surface-2 align-middle" aria-hidden>
      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </span>
  );
}

function Axis({ height, ticks, format }: { height: number; ticks: number[]; format: (t: number) => string }) {
  return (
    <div className="num relative w-12 shrink-0 text-right text-[10px] text-muted" style={{ height }} aria-hidden>
      {ticks.map((t, i) => (
        <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}>
          {format(t)}
        </span>
      ))}
    </div>
  );
}

function Grid({ height, lines }: { height: number; lines: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height }} aria-hidden>
      {Array.from({ length: lines + 1 }, (_, i) => (
        <div
          key={i}
          className="absolute inset-x-0 h-px"
          style={{ top: `${(i / lines) * 100}%`, background: i === lines ? "var(--axis)" : "var(--grid)" }}
        />
      ))}
    </div>
  );
}

function XLabels({ columns }: { columns: { key: string; label: string; sub?: string }[] }) {
  return (
    <div className="mt-1.5 flex gap-2">
      <div className="w-12 shrink-0" />
      <div className="flex flex-1 justify-around">
        {columns.map((c) => (
          <div key={c.key} className="w-0 overflow-visible text-center">
            <div className="-ml-12 w-24 text-[11px] leading-tight">{c.label}</div>
            {c.sub && <div className="-ml-12 w-24 text-[10px] text-muted">{c.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
