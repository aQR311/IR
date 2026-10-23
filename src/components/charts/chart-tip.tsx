"use client";

import { useRef, useState, type ReactNode } from "react";

/**
 * Lớp hover dùng chung: mọi mark có `data-tip="Dòng 1|Dòng 2"` sẽ hiện tooltip khi rê chuột / chạm.
 * Biểu đồ vẫn render ở server; client chỉ lo vị trí tooltip.
 */
export function ChartTip({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);

  const show = (target: EventTarget | null, clientX: number, clientY: number) => {
    const el = (target as Element | null)?.closest?.("[data-tip]");
    const box = ref.current?.getBoundingClientRect();
    if (!el || !box) return setTip(null);
    setTip({ x: clientX - box.left, y: clientY - box.top, lines: (el.getAttribute("data-tip") ?? "").split("|") });
  };

  return (
    <div
      ref={ref}
      className={`relative ${className}`}
      onPointerMove={(e) => show(e.target, e.clientX, e.clientY)}
      onPointerLeave={() => setTip(null)}
    >
      {children}
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: tip.x, top: tip.y - 10 }}
        >
          <div className="font-medium">{tip.lines[0]}</div>
          {tip.lines.slice(1).map((l, i) => (
            <div key={i} className="num text-muted">{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
