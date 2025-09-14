// src/ui/components/AISummaryPanel.jsx
import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const DEFAULT_API = import.meta?.env?.VITE_API_BASE || "http://localhost:8000";
export default function AISummaryPanel({ results, apiBase = DEFAULT_API }) {
  const [md, setMd] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [locale, setLocale] = useState("en"); // language for summary

  // payload for possible logging
  const payload = useMemo(
    () => ({
      measurements: (results?.measurements || []).map((m) => ({
        name: m.name,
        value: m.value,
        unit: m.unit,
        reference_text: m.reference_text,
        flag: m.flag,
        group: m.group || null,
      })),
    }),
    [results]
  );

  const callBackend = async (lang) => {
    if (!results) return;
    setLoading(true);
    setErr("");
    setMd("");
    if (!apiBase) { setErr("API Base URL Not Found"); return; }
    try {
      const resp = await fetch(`${apiBase}/api/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // main.py waiting: { report: ParseResponse, locale: "ru"|"en" etc}
        body: JSON.stringify({ report: results, locale: lang || locale }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json(); // { summary_md, model }
      setMd(data.summary_md || "_EMPTY RESPONSE._");
    } catch (e) {
      setErr(e.message || "Generation error");
    } finally {
      setLoading(false);
    }
  };

  // auto call on results change or locale change
  useEffect(() => {
    if ((results?.measurements || []).length) {
      callBackend(locale);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, JSON.stringify(results?.measurements || [])]);

  return (
    <aside className="card p-4 lg:sticky lg:top-6 h-fit">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">AI-summary</h3>
        <div className="flex items-center gap-2">
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="text-xs px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            title="Summary language"
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
            <option value="ua">Українська</option>
            <option value="fr">Francais</option>
          </select>
          <button
            className="text-xs px-2 py-1 rounded-md bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700"
            onClick={() => callBackend(locale)}
            disabled={loading}
            title="Regenerate summary"
          >
            {loading ? "Generation…" : "Update"}
          </button>
        </div>
      </div>

      {err && <div className="text-xs text-rose-500 mb-2">Ошибка: {err}</div>}

      {loading && (
        <div className="animate-pulse text-sm text-slate-500">
          Preparing brief resume…
        </div>
      )}

      {!loading && !err && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {md || "_NO DATA FOR THE SUMMARY._"}
          </ReactMarkdown>
        </div>
      )}
    </aside>
  );
}