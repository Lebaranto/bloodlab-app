import React, { useState, useRef } from "react";
import UploadZone from "./components/UploadZone.jsx";
import ResultsTable from "./components/ResultsTable.jsx";
import CompositePanels from "./components/CompositePanels.jsx";
import GroupedResults from "./components/GroupedResults.jsx";
import AISummaryPanel from "./components/AISummaryPanel.jsx";
import DemographicsModal from "./components/DemographicsModal.jsx";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export default function App() {
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(null);

  // Demography
  const [demographics, setDemographics] = useState({ sex: null, age: null, race: "nonblack" });
  const [askDemoOpen, setAskDemoOpen] = useState(false);

  const [progress, setProgress] = useState({
    total: 0, step: 0, percent: 0,
    filename: "", page: 0, pages_in_file: 0
  });

  const inputRef = useRef();

  // json download
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
            finished = true;

            // show demographics modal if needed
            const hasSex = !!demographics.sex;
            const hasAge = demographics.age != null && Number(demographics.age) > 0;
            if (!hasSex || !hasAge) setAskDemoOpen(true);
            break;
          }
        }
      }
    } catch (e) {
      alert("Error: " + e.message);
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
          High-quality analysis of your tests. Just upload a photo or PDF with the results, and we will show you what is important to know!
          <span className="ml-1 opacity-70">*Not a medical diagnosis.</span>
        </p>
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-24">
        <section className="card p-6">
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <UploadZone onFiles={onFiles} inputRef={inputRef} />
              {files.length > 0 && (
                <div className="mt-4">
                  <h3 className="font-semibold mb-2">Files ({files.length})</h3>
                  <ul className="space-y-2">
                    {files.map((f, i) => (
                      <li key={i} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2">
                        <div className="truncate">
                          <span className="font-medium">{f.name}</span>
                          <span className="ml-2 text-xs opacity-70">{(f.size/1024/1024).toFixed(2)} MB</span>
                        </div>
                        <button className="text-rose-600 hover:underline text-sm" onClick={() => removeFile(i)}>remove</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex flex-col justify-between bg-slate-50 dark:bg-slate-900/40 rounded-2xl p-4 border border-slate-200 dark:border-slate-800">
              <div>
                <div className="text-sm text-slate-600 dark:text-slate-300">Steps</div>
                <ol className="mt-2 space-y-2 text-sm">
                  <li>1. Upload your analysis images/PDF</li>
                  <li>2. We will detect your key values</li>
                  <li>3. Connecting them with our curated database for references</li>
                  <li>4. Your qualified interpretation + possibility to download</li>
                </ol>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  onClick={process}
                  disabled={isLoading || !files.length}
                  className="w-full py-2 rounded-xl bg-rose-600 text-white font-semibold disabled:opacity-50"
                >
                  {isLoading ? "Processing..." : "Start interpretation"}
                </button>

                {/* Demography prompt manually */}
                <button
                  onClick={() => setAskDemoOpen(true)}
                  className="w-full py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Choose your sex/age (for exact metrics)
                </button>

                {results && !isLoading && (
                  <button
                    onClick={downloadJSON}
                    className="w-full py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                    title="Download JSON"
                  >
                    Download JSON
                  </button>
                )}

                {isLoading && (
                  <div className="mt-2">
                    <div className="text-sm mb-1 opacity-80">
                      Processing: <span className="font-medium">{progress.filename || "…"}</span>
                      {progress.page ? ` (стр. ${progress.page}/${progress.pages_in_file || "?"})` : null}
                    </div>
                    <div className="w-full h-3 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-3 bg-rose-600 transition-all duration-300" style={{ width: `${progress.percent}%` }} />
                    </div>
                    <div className="text-xs mt-1 opacity-70">{progress.percent}% — step {progress.step} из {progress.total || "?"}</div>
                  </div>
                )}

                {results && !isLoading && (
                  <div className="mt-1 text-sm">
                    {abnormalCount === 0 ? (
                      <span className="badge badge-green">All in reference values</span>
                    ) : (
                      <span className="badge badge-amber">{abnormalCount} parameters not normal</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {results && (
          <section className="mt-8 grid lg:grid-cols-3 gap-6 items-start">
            {/* Left part: tables and panels */}
            <div className="lg:col-span-2 space-y-6">
              <section className="card p-6">
                <GroupedResults measurements={results.measurements || []} />
              </section>

              {/* demographics */}
              <CompositePanels
                measurements={results.measurements || []}
                demographics={demographics}
              />
            </div>

            {/* Right part: AI-summary  */}
            <AISummaryPanel results={results} apiBase={API_BASE} />
          </section>
        )}
      </main>

      <footer className="text-center text-xs text-slate-500 py-10">
        © {new Date().getFullYear()} BloodLab — experimental instrument. Developed by Nikita Miroshnichenko
      </footer>

      {/* Модалка демографии */}
      <DemographicsModal
        open={askDemoOpen}
        onClose={() => setAskDemoOpen(false)}
        onSave={(data) => { setDemographics(data); setAskDemoOpen(false); }}
        initial={demographics}
      />
    </div>
  );
}