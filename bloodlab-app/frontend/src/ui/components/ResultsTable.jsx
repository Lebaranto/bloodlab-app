// src/ui/components/ResultsTable.jsx
import React from "react";

function Badge({ flag }) {
  if (flag === "high") return <span className="badge badge-red">⬆️</span>;
  if (flag === "low") return <span className="badge badge-red">⬇️</span>;
  if (flag === "normal") return <span className="badge badge-green">✅</span>;
  return <span className="badge badge-gray">—</span>;
}

export default function ResultsTable({ data }) {
  const rows = (data?.measurements || []).map((m, i) => ({
    name: m.name || "—",
    value: m.value ? `${m.value}${m.unit ? ` ${m.unit}` : ""}` : "—",
    // ref text from OCR or DB as it is
    reference: m.reference_text || "—",
    flag: m.flag || "unknown",
  }));

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/50">
          <tr>
            <th className="px-4 py-3 text-left">Parameter</th>
            <th className="px-4 py-3 text-left">Value</th>
            <th className="px-4 py-3 text-left">Reference</th>
            <th className="px-4 py-3 text-left">Flag</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r, idx) => (
            <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
              <td className="px-4 py-3 font-medium">{r.name}</td>
              <td className="px-4 py-3">{r.value}</td>
              <td className="px-4 py-3 tabular-nums">{r.reference}</td>
              <td className="px-4 py-3"><Badge flag={r.flag} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}