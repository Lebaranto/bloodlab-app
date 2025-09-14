import React, { useState, useRef } from "react";
import UploadZone from "./components/UploadZone.jsx";
import ResultsTable from "./components/ResultsTable.jsx";
import CompositePanels from "./components/CompositePanels.jsx";
import GroupedResults from "./components/GroupedResults.jsx";
import AISummaryPanel from "./components/AISummaryPanel.jsx";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export default function App() {
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(null);

  const [progress, setProgress] = useState({
    total: 0, step: 0, percent: 0,
    filename: "", page: 0, pages_in_file: 0
  });

  const inputRef = useRef();

  // скачать JSON
  const downloadJSON = () => {
    if (!results) return;
    const fname = `bloodlab_results_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.json`;
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  };

  const onFiles = (newFiles) => {
    const unique = [];
    const seen = new Set(files.map(f => f.name + f.size));
    for (const f of newFiles) {
      const key = f.name + f.size;
      if (!seen.has(key)) { unique.push(f); seen.add(key); }
    }
    setFiles(prev => [...prev, ...unique]);
  };

  const removeFile = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const process = async () => {
    if (!files.length || isLoading) return;
    setIsLoading(true);
    setResults(null);
    setProgress({ total: 0, step: 0, percent: 0, filename: "", page: 0, pages_in_file: 0 });

    try {
      const fd = new FormData();
      files.forEach(f => fd.append("files", f));

      const resp = await fetch(`${API_BASE}/api/process/stream`, {
        method: "POST",
        body: fd,
      });

      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let finished = false;

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          const lines = chunk.split("\n").map(l => l.trim());
          let event = null, dataStr = null;
          for (const l of lines) {
            if (l.startsWith("event:")) event = l.slice(6).trim();
            else if (l.startsWith("data:")) dataStr = l.slice(5).trim();
          }
          if (!event || !dataStr) continue;

          const data = JSON.parse(dataStr);

          if (event === "meta") {
            setProgress(p => ({ ...p, total: data.total_steps || 0 }));
          } else if (event === "progress") {
            setProgress({
              total: data.total,
              step: data.step,
              percent: data.percent,
              filename: data.filename,
              page: data.page,
              pages_in_file: data.pages_in_file
            });
          } else if (event === "done") {
            setResults(data);
            setIsLoading(false);
            finished = true; // завершаем цикл
            break;
          }
        }
      }
    } catch (e) {
      alert("Ошибка: " + e.message);
      setIsLoading(false);
    }
  };

  const abnormalCount = (results?.measurements || []).filter(m => m.flag === "high" || m.flag === "low").length;

  return (
    <div className="min-h-screen gradient-hero">
      <header className="max-w-6xl mx-auto px-4 py-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-rose-600"></div>
          <h1 className="text-2xl font-bold tracking-tight">BloodLab</h1>
        </div>
        <p className="mt-2 text-slate-600 dark:text-slate-300 max-w-2xl">
          Качественный разбор ваших анализов. Просто загрузите фото или PDF с результатами, и мы покажем, что в них важно знать!
          <span className="ml-1 opacity-70">*Не является мед. диагнозом.</span>
        </p>
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-24">
        <section className="card p-6">
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <UploadZone onFiles={onFiles} inputRef={inputRef} />
              {files.length > 0 && (
                <div className="mt-4">
                  <h3 className="font-semibold mb-2">Файлы ({files.length})</h3>
                  <ul className="space-y-2">
                    {files.map((f, i) => (
                      <li key={i} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2">
                        <div className="truncate">
                          <span className="font-medium">{f.name}</span>
                          <span className="ml-2 text-xs opacity-70">{(f.size/1024/1024).toFixed(2)} МБ</span>
                        </div>
                        <button className="text-rose-600 hover:underline text-sm" onClick={() => removeFile(i)}>удалить</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex flex-col justify-between bg-slate-50 dark:bg-slate-900/40 rounded-2xl p-4 border border-slate-200 dark:border-slate-800">
              <div>
                <div className="text-sm text-slate-600 dark:text-slate-300">Шаги</div>
                <ol className="mt-2 space-y-2 text-sm">
                  <li>1. Загрузите фото/PDF</li>
                  <li>2. Мы распознаем ключевые значения</li>
                  <li>3. Подключаем нашу внутреннюю верифицированную базу знаний</li>
                  <li>4. Ваша интерпретация + возможность скачать отчёт</li>
                </ol>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={process}
                  disabled={isLoading || !files.length}
                  className="w-full py-2 rounded-xl bg-rose-600 text-white font-semibold disabled:opacity-50"
                >
                  {isLoading ? "Обработка..." : "Запустить интерпретацию"}
                </button>
                {results && !isLoading && (
                  <button
                    onClick={downloadJSON}
                    className="py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                    title="Скачать JSON"
                  >
                    Скачать JSON
                  </button>
                )}
              </div>

              {isLoading && (
                <div className="mt-4">
                  <div className="text-sm mb-1 opacity-80">
                    Обрабатываем: <span className="font-medium">{progress.filename || "…"}</span>
                    {progress.page ? ` (стр. ${progress.page}/${progress.pages_in_file || "?"})` : null}
                  </div>
                  <div className="w-full h-3 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-3 bg-rose-600 transition-all duration-300" style={{ width: `${progress.percent}%` }} />
                  </div>
                  <div className="text-xs mt-1 opacity-70">{progress.percent}% — шаг {progress.step} из {progress.total || "?"}</div>
                </div>
              )}

              {results && !isLoading && (
                <div className="mt-3 text-sm">
                  {abnormalCount === 0 ? (
                    <span className="badge badge-green">Все в референсе</span>
                  ) : (
                    <span className="badge badge-amber">{abnormalCount} показателя вне нормы</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {results && (
          <section className="mt-8 grid lg:grid-cols-3 gap-6 items-start">
            {/* Левая часть: таблицы и панели */}
            <div className="lg:col-span-2 space-y-6">
              <section className="card p-6">
                <GroupedResults measurements={results.measurements || []} />
              </section>

              <CompositePanels measurements={results.measurements || []} />
            </div>

            {/* Правая часть: AI-саммари (через бэкенд /api/summary) */}
            <AISummaryPanel results={results} apiBase={API_BASE} />
          </section>
        )}
      </main>

      <footer className="text-center text-xs text-slate-500 py-10">
        © {new Date().getFullYear()} BloodLab — experimental instrument. Developed by Nikita Miroshnichenko
      </footer>
    </div>
  );
}
