import React from "react";

function Badge({ flag }) {
  if (flag === "high") return <span className="badge badge-red">⬆️</span>;
  if (flag === "low") return <span className="badge badge-red">⬇️</span>;
  if (flag === "normal") return <span className="badge badge-green">✅</span>;
  return <span className="badge badge-gray">—</span>;
}

const GROUP_ORDER = [
  "Hematologie",
  "Biochimie",
  "Electrolytes",
  "Serologie",
  "Microbiologie",
  "Biometric data",
  "Vaccination info",
  "Other",
];

export default function GroupedResults({ measurements = [] }) {
  if (!measurements.length) {
    return <p className="text-sm opacity-70">No data for show.</p>;
  }

  // Grouping measurements by their group
  const grouped = measurements.reduce((acc, m) => {
    const g = m.group || "Other";
    if (!acc[g]) acc[g] = [];
    acc[g].push(m);
    return acc;
  }, {});

  // Sorting, starting from flag and then by name
  const sortItems = (arr) =>
    [...arr].sort((a, b) => {
      const rank = (f) => (f === "high" || f === "low" ? 0 : f === "normal" ? 1 : 2);
      const ra = rank(a.flag), rb = rank(b.flag);
      if (ra !== rb) return ra - rb;
      return (a.name || "").localeCompare(b.name || "", "ru");
    });

  const orderedGroups = GROUP_ORDER.filter((g) => grouped[g]?.length)
    .concat(Object.keys(grouped).filter((g) => !GROUP_ORDER.includes(g)));

  return (
    <div className="space-y-10">
      {orderedGroups.map((group) => {
        const rows = sortItems(grouped[group]).map((m) => ({
          name: m.name || "—",
          value: m.value ? `${m.value}${m.unit ? ` ${m.unit}` : ""}` : "—",
          reference: m.reference_text || "—", 
          flag: m.flag || "unknown",
        }));

        return (
          <section key={group}>
            <h3 className="font-semibold text-lg mb-3">{group}</h3>
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
          </section>
        );
      })}
    </div>
  );
}