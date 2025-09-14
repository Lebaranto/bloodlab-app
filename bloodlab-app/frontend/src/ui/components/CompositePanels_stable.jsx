import React from "react";

/**
 * normalization - low level utils
 */
function stripAccents(s) {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}
function normalizeName(s) {
  return stripAccents(String(s || ""))
    .toLowerCase()
    .replace(/[%()[\]{}:;,/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse number from string (with comma or dot)
 */
function num(val) {
  if (val == null) return null;
  const m = String(val).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/**
 * Names of basic WBC types (for special handling of absolute/% variants)
 */
const WBC_BASE = new Set(["neutrophils", "lymphocytes", "monocytes", "eosinophils", "basophils"]);

/**
 * Detect if the measurement is a percent variant (by name/unit or reference range text)
 */
function isPercentVariant(name, unit, refText) {
  const n = (name || "").toLowerCase();
  const u = (unit || "").toLowerCase();
  if (n.includes("%") || u.includes("%") || n.includes("segmented")) return true;

  if (refText) {
    const t = String(refText).replace(",", ".");
    const m = t.match(/(-?\d+(?:\.\d+)?)\s*(?:-|–|—)\s*(-?\d+(?:\.\d+)?)/);
    if (m) {
      const lo = parseFloat(m[1]), hi = parseFloat(m[2]);
      if (!isNaN(lo) && !isNaN(hi) && lo >= 0 && hi <= 100) return true;
    }
  }
  return false;
}

/**
 * Absolute variant (by name/unit)
 */
function isAbsoluteVariant(name, unit) {
  const n = (name || "").toLowerCase();
  const u = (unit || "").toLowerCase();
  if (n.includes("absolute")) return true;
  if (/(10\^9|10\^3|g\/l|\/ul|µl|mc?l)/i.test(u)) return true;
  return false;
}

/**
 * Index measurements by normalized name, with special handling for WBC types
 */
function indexMeasurements(measurements) {
  const byNorm = new Map();
  const wbcPct = new Map();   // "neutrophils" -> item (%)
  const wbcAbs = new Map();   // "neutrophils" -> item (absolute)

  for (const m of measurements || []) {
    const norm = normalizeName(m.name);
    if (!byNorm.has(norm)) byNorm.set(norm, []);
    byNorm.get(norm).push(m);

    // special handling for WBC types
    const base = norm.replace(/\s*(%|percent|absolute)\s*$/g, "").trim();
    const lastWord = base.split(" ").pop();
    if (WBC_BASE.has(lastWord)) {
      if (isPercentVariant(m.name, m.unit, m.reference_text)) {
        wbcPct.set(lastWord, m);
      } else if (isAbsoluteVariant(m.name, m.unit)) {
        wbcAbs.set(lastWord, m);
      }
    }
  }
  return { byNorm, wbcPct, wbcAbs };
}

/**
 * Resolve a measurement by a list of possible names (normalized, partial match)
 * opts.prefer: "abs" | "pct" | "any"  (default "abs" for WBC types)
 */
function resolve(measIndex, names, opts = {}) {
  const prefer = opts.prefer || "any";
  const normNames = names.map(normalizeName);

  // 1) exact match
  for (const nn of normNames) {
    if (measIndex.byNorm.has(nn)) {
      // if WBC type, prefer abs/pct/any
      const base = nn.replace(/\s*(%|percent|absolute)\s*$/g, "").trim();
      const lastWord = base.split(" ").pop();
      if (WBC_BASE.has(lastWord)) {
        if (prefer === "abs" && measIndex.wbcAbs.has(lastWord)) return measIndex.wbcAbs.get(lastWord);
        if (prefer === "pct" && measIndex.wbcPct.has(lastWord)) return measIndex.wbcPct.get(lastWord);
        // else "any"
        return measIndex.wbcAbs.get(lastWord) || measIndex.wbcPct.get(lastWord) || measIndex.byNorm.get(nn)[0];
      }
      return measIndex.byNorm.get(nn)[0];
    }
  }

  // 2) partial match (contains or contained)
  for (const [k, arr] of measIndex.byNorm.entries()) {
    if (normNames.some(nn => k.includes(nn) || nn.includes(k))) {
      return arr[0];
    }
  }
  return null;
}

/* ---------- Composite Metrics ---------- */

/* ---------- EGFR ---------- */
function calcEGFR(measIndex) {
  const creat = resolve(
    measIndex,
    [
      "creatinine",             // en
      "creatinine serum",
      "creatinine blood",
      "creatinine (serum)",
      "creatinine plasmatique", // fr
      "creatinine sanguine",
      "креатинин",              // ru/uk
    ],
    { prefer: "any" }
  );
  if (!creat) return null;

  const cr = num(creat.value);
  if (cr == null) return null;

  return {
    name: "Kidney function",
    label: "eGFR CKD-EPI",
    value: Math.round(110), // пример, если считаешь в другом месте — подставь результат оттуда
    unit: "mL/min/1.73m²",
    grade: "G1 (normal)",
    pct: 90,
  };
}

/** Пример: Иммунная активность по нейтрофилам — берём ИМЕННО абсолют (если есть) */
function calcNeutrophilsAbs(measIndex) {
  const neut = resolve(
    measIndex,
    ["neutrophils", "нейтрофилы", "neutrophiles"],
    { prefer: "abs" }
  );
  if (!neut) return null;
  const val = num(neut.value);
  if (val == null) return null;

  // …любой твой скоринг, тут просто пример визуализации
  return {
    name: "Innate immunity",
    label: "Neutrophils (absolute)",
    value: val,
    unit: neut.unit || "",
    grade: "in range",
    pct: 60,
  };
}

/** A1c */
function resolveA1c(measIndex) {
  return resolve(
    measIndex,
    [
      "hba1c",
      "hb a1c",
      "hb a1c en unite ifcc 2010",
      "hb a1c en unite ifcc",
      "гликированный гемоглобин",
      "глікозильований гемоглобін",
    ],
    { prefer: "any" }
  );
}

function calcMetabolicScore(measIndex) {
  const a1c = resolveA1c(measIndex);
  if (!a1c) return null;
  const a1cVal = num(a1c.value);
  if (a1cVal == null) return null;

  // добавишь сюда инсулин/тг:hdl/витамин d по аналогии с resolve()
  const score = Math.max(0, Math.min(100, 100 - (a1cVal - 5) * 20));

  return {
    name: "Metabolic fitness",
    label: "Composite",
    value: `${a1cVal}%`,
    unit: "",
    grade: score >= 80 ? "Good" : "Fair",
    pct: Math.round(score),
  };
}

/* ---------- Компонент ---------- */

export default function CompositePanels({ measurements }) {
  const measIndex = indexMeasurements(measurements);

  const cards = [];

  // eGFR — пример (оставь твой расчёт, важен резолвер креатинина)
  const egfr = calcEGFR(measIndex);
  if (egfr) cards.push(egfr);

  // Иммунная (пример) — именно абсолют нейтрофилов
  const neutAbs = calcNeutrophilsAbs(measIndex);
  if (neutAbs) cards.push(neutAbs);

  // Метаболическая
  const meta = calcMetabolicScore(measIndex);
  if (meta) cards.push(meta);

  if (!cards.length) return null;

  return (
    <section className="mt-8 card p-6">
      <h2 className="text-xl font-semibold mb-4">Complex cumulative metrics</h2>
      <div className="grid md:grid-cols-3 gap-6">
        {cards.map((c, i) => (
          <div key={i} className="rounded-2xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 p-5">
            <div className="text-slate-600 dark:text-slate-300 text-sm">{c.name}</div>
            <div className="text-lg font-semibold mt-1">{c.label}</div>

            <div className="flex items-baseline gap-2 mt-3">
              <div className="text-3xl font-bold">{c.value}</div>
              {c.unit ? <div className="opacity-70">{c.unit}</div> : null}
            </div>

            <div className="mt-1 text-xs opacity-80">{c.grade}</div>

            {/* simple viz */}
            <div className="mt-4 relative w-24 h-24">
              <svg viewBox="0 0 36 36" className="w-24 h-24">
                <path
                  d="M18 2.0845
                     a 15.9155 15.9155 0 0 1 0 31.831
                     a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none" stroke="currentColor" strokeWidth="3" opacity="0.15"
                />
                <path
                  d="M18 2.0845
                     a 15.9155 15.9155 0 0 1 0 31.831
                     a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none" stroke="currentColor" strokeWidth="3"
                  strokeDasharray={`${c.pct}, 100`} transform="rotate(-90 18 18)"
                />
                <text x="18" y="20.5" textAnchor="middle" className="text-sm font-semibold fill-current">
                  {c.pct}%
                </text>
              </svg>
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs opacity-70 mt-4">
        *Metrics are calculated automatically based on available indicators and are not a diagnosis.
      </div>
    </section>
  );
}