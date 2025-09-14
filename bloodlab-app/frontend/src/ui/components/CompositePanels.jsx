// src/ui/components/CompositePanels.jsx
import React from "react";

/* -------------------- NORMALIZATION / PARSING -------------------- */

function stripAccents(s) {
  return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}
function normalizeName(s) {
  return stripAccents(String(s || ""))
    .toLowerCase()
    .replace(/[%()[\]{}:;,/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function num(val) {
  if (val == null) return null;
  const m = String(val).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/* -------------------- SPECIFIC RULES FOR WBC -------------------- */

const WBC_BASE = new Set(["neutrophils", "lymphocytes", "monocytes", "eosinophils", "basophils"]);

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
function isAbsoluteVariant(name, unit) {
  const n = (name || "").toLowerCase();
  const u = (unit || "").toLowerCase();
  if (n.includes("absolute")) return true;
  if (/(10\^9|10\^3|g\/l|\/ul|µl|mc?l)/i.test(u)) return true;
  return false;
}

/* -------------------- RESOLVER INDEX -------------------- */

function indexMeasurements(measurements) {
  const byNorm = new Map();
  const wbcPct = new Map();
  const wbcAbs = new Map();

  for (const m of measurements || []) {
    const norm = normalizeName(m.name);
    if (!byNorm.has(norm)) byNorm.set(norm, []);
    byNorm.get(norm).push(m);

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
 * SEARCHING PARAM NAME IN LIST OF POSSBIBLE VALUES.
 * opts.prefer: "abs" | "pct" | "any"
 */
function resolve(measIndex, names, opts = {}) {
  const prefer = opts.prefer || "any";
  const normNames = names.map(normalizeName);

  // 1) exact match
  for (const nn of normNames) {
    if (measIndex.byNorm.has(nn)) {
      const base = nn.replace(/\s*(%|percent|absolute)\s*$/g, "").trim();
      const lastWord = base.split(" ").pop();
      if (WBC_BASE.has(lastWord)) {
        if (prefer === "abs" && measIndex.wbcAbs.has(lastWord)) return measIndex.wbcAbs.get(lastWord);
        if (prefer === "pct" && measIndex.wbcPct.has(lastWord)) return measIndex.wbcPct.get(lastWord);
        return measIndex.wbcAbs.get(lastWord) || measIndex.wbcPct.get(lastWord) || measIndex.byNorm.get(nn)[0];
      }
      return measIndex.byNorm.get(nn)[0];
    }
  }

  // 2) partial
  for (const [k, arr] of measIndex.byNorm.entries()) {
    if (normNames.some(nn => k.includes(nn) || nn.includes(k))) {
      return arr[0];
    }
  }
  return null;
}

/* -------------------- UNITY CONVERSION -------------------- */

// Creatinine: µmol/L → mg/dL
function creatToMgDl(value, unit) {
  const v = num(value);
  if (v == null) return null;
  const u = String(unit || "").toLowerCase();
  if (u.includes("µmol") || u.includes("мкмоль") || u.includes("umol")) {
    return v / 88.4;
  }
  return v; 
}

// Cholesterine: mmol/L ↔ mg/dL
function cholToMgDl(value, unit) {
  const v = num(value);
  if (v == null) return null;
  const u = String(unit || "").toLowerCase();
  if (u.includes("mmol")) return v * 38.67;
  return v;
}
function cholToMmolL(value, unit) {
  const v = num(value);
  if (v == null) return null;
  const u = String(unit || "").toLowerCase();
  if (u.includes("mg/dl") || u.includes("mgdl")) return v / 38.67;
  return v;
}

// Triglicerides: mmol/L ↔ mg/dL
function tgToMgDl(value, unit) {
  const v = num(value);
  if (v == null) return null;
  const u = String(unit || "").toLowerCase();
  if (u.includes("mmol")) return v * 88.57;
  return v;
}
function tgToMmolL(value, unit) {
  const v = num(value);
  if (v == null) return null;
  const u = String(unit || "").toLowerCase();
  if (u.includes("mg/dl") || u.includes("mgdl")) return v / 88.57;
  return v;
}

// Thrombocytes
function plateletsTo10e9L(value, unit) {
  const v = num(value);
  if (v == null) return null;
  const u = String(unit || "").toLowerCase();
  if (/(10\^9|x10\^9|g\/l)/.test(u)) return v;           
  if (/(10\^3|x10\^3|\/ul|µl|mc?l)/.test(u)) return v;   
  
  return v;
}

/* -------------------- METRICS -------------------- */

/** eGFR CKD-EPI 2021 */
function metric_eGFR(measIndex, demographics) {
  const creat = resolve(measIndex, ["creatinine", "креатинин", "creatinine plasmatique", "creatinine serum"]);
  if (!creat) return null;

  const cr_mgdl = creatToMgDl(creat.value, creat.unit);
  if (cr_mgdl == null) return null;

  const sex = demographics?.sex || null;  // "male"|"female"
  const age = Number(demographics?.age ?? NaN);
  if (!sex || !age || isNaN(age) || age <= 0) {
    return {
      name: "Kidney function",
      label: "eGFR (CKD-EPI 2021)",
      value: "—",
      unit: "mL/min/1.73m²",
      grade: "Age and sex required",
      pct: 0,
    };
  }

  const kappa = sex === "female" ? 0.7 : 0.9;
  const alpha = sex === "female" ? -0.241 : -0.302;
  const scr_k = cr_mgdl / kappa;
  const egfr =
    142 *
    Math.pow(Math.min(scr_k, 1), alpha) *
    Math.pow(Math.max(scr_k, 1), -1.2) *
    Math.pow(0.9938, age);

  const g = egfr >= 90 ? "G1 (normal)" :
            egfr >= 60 ? "G2 (mild ↓)" :
            egfr >= 45 ? "G3a (mild–mod ↓)" :
            egfr >= 30 ? "G3b (mod–severe ↓)" :
            egfr >= 15 ? "G4 (severe ↓)" : "G5 (failure)";

  return {
    name: "Kidney function",
    label: "eGFR (CKD-EPI 2021)",
    value: isFinite(egfr) ? egfr.toFixed(0) : "—",
    unit: "mL/min/1.73m²",
    grade: g,
    pct: isFinite(egfr) ? Math.max(0, Math.min(100, Math.round((egfr / 120) * 100))) : 0,
  };
}

/** FIB-4: (Age × AST) / (PLT × √ALT). Requires: age, AST, ALT, PLT */
function metric_FIB4(measIndex, demographics) {
  const age = Number(demographics?.age ?? NaN);
  if (!age || isNaN(age) || age <= 0) return null;

  const ast = resolve(measIndex, ["ast", "асат", "got", "aspartate aminotransferase", "asat"]);
  const alt = resolve(measIndex, ["alt", "алат", "gpt", "alanine aminotransferase", "alat"]);
  const plt = resolve(measIndex, ["platelets", "plt", "тромбоциты", "plaquettes"]);

  const AST = num(ast?.value);
  const ALT = num(alt?.value);
  const PLT = plateletsTo10e9L(plt?.value, plt?.unit);

  if (AST == null || ALT == null || PLT == null || PLT <= 0) return null;

  const fib4 = (age * AST) / (PLT * Math.sqrt(ALT));

  let grade;
  if (age >= 65) {
    grade = fib4 < 2.0 ? "low fibrosis risk" : fib4 <= 2.67 ? "average risk" : "High fiborsis risk";
  } else {
    grade = fib4 < 1.3 ? "low fibrosis risk" : fib4 <= 2.67 ? "average risk" : "High fiborsis risk";
  }

  return {
    name: "Liver fibrosis risk",
    label: "FIB-4",
    value: fib4.toFixed(2),
    unit: "",
    grade,
    pct: Math.max(0, Math.min(100, Math.round((Math.min(fib4, 3) / 3) * 100))),
  };
}

/** De Ritis ratio (AST/ALT) */
function metric_DeRitis(measIndex) {
  const ast = resolve(measIndex, ["ast", "асат", "got", "aspartate aminotransferase", "asat"]);
  const alt = resolve(measIndex, ["alt", "алат", "gpt", "alanine aminotransferase", "alat"]);

  const AST = num(ast?.value);
  const ALT = num(alt?.value);
  if (AST == null || ALT == null || ALT === 0) return null;

  const ratio = AST / ALT;
  let grade = "Normal/nonspecific";
  if (ratio > 1.5) grade = "↑ Possible fibrosis/алкогольное поражение";
  else if (ratio < 0.8) grade = "↓ Больше похоже на цитолиз ALT>AST";

  return {
    name: "Liver function",
    label: "De Ritis (AST/ALT)",
    value: ratio.toFixed(2),
    unit: "",
    grade,
    pct: Math.max(0, Math.min(100, Math.round((Math.min(ratio, 2) / 2) * 100))),
  };
}

/** AIP (Atherogenic Index of Plasma) = log10(TG/HDL) в mmol/l */
function metric_AIP(measIndex) {
  const tg = resolve(measIndex, ["triglycerides", "tg", "триглицериды", "triglycérides"]);
  const hdl = resolve(measIndex, ["hdl", "hdl cholesterol", "лпвп", "hdl-c"]);

  const TG_mmol = tgToMmolL(tg?.value, tg?.unit);
  const HDL_mmol = cholToMmolL(hdl?.value, hdl?.unit);
  if (TG_mmol == null || HDL_mmol == null || HDL_mmol <= 0) return null;

  const aip = Math.log10(TG_mmol / HDL_mmol);
  const grade = aip < 0.11 ? "Low risk" : aip <= 0.21 ? "Average risk" : "High risk";

  return {
    name: "Atherogenic risk",
    label: "AIP = log10(TG/HDL)",
    value: aip.toFixed(2),
    unit: "",
    grade,
    pct: Math.max(0, Math.min(100, Math.round((Math.min(aip, 0.5) / 0.5) * 100))), // 0..0.5 → 0..100
  };
}

/** TG/HDL и TC/HDL */
function metric_LipidRatios(measIndex) {
  const tg = resolve(measIndex, ["triglycerides", "tg", "триглицериды"]);
  const hdl = resolve(measIndex, ["hdl", "hdl cholesterol", "лпвп"]);
  const tc = resolve(measIndex, ["cholesterol total", "total cholesterol", "общий холестерин", "cholesterol"]);

  const TG = tgToMgDl(tg?.value, tg?.unit);
  const HDL = cholToMgDl(hdl?.value, hdl?.unit);
  const TC  = cholToMgDl(tc?.value, tc?.unit);

  const cards = [];

  if (TG != null && HDL != null && HDL > 0) {
    const r = TG / HDL;
    const grade = r < 2 ? "Excellent" : r <= 3 ? "Acceptable" : "Unfavorable";
    cards.push({
      name: "Lipid risk",
      label: "TG/HDL (mg/dL)",
      value: r.toFixed(2),
      unit: "",
      grade,
      pct: Math.max(0, Math.min(100, Math.round((Math.min(r, 5) / 5) * 100))),
    });
  }

  if (TC != null && HDL != null && HDL > 0) {
    const r = TC / HDL;
    const grade = r < 3.5 ? "Target" : r <= 5 ? "Border" : "High";
    cards.push({
      name: "Lipid risk",
      label: "TC/HDL (mg/dL)",
      value: r.toFixed(2),
      unit: "",
      grade,
      pct: Math.max(0, Math.min(100, Math.round((Math.min(r, 6) / 6) * 100))),
    });
  }

  return cards;
}

/** NLR — Neutrophil/Lymphocyte Ratio (preference for absolute values) */
function metric_NLR(measIndex) {
  const neut = resolve(measIndex, ["neutrophils", "нейтрофилы", "neutrophiles"], { prefer: "abs" });
  const lymph = resolve(measIndex, ["lymphocytes", "лимфоциты", "lymphocytes"], { prefer: "abs" });

  const N = num(neut?.value);
  const L = num(lymph?.value);
  if (N == null || L == null || L === 0) return null;

  const nlr = N / L;
  let grade = "Normal";
  if (nlr > 3) grade = "↑ Possible system inflammation / infection";
  else if (nlr < 1) grade = "↓ Limphocytosis/variant of norma";

  return {
    name: "Inflammation",
    label: "NLR",
    value: nlr.toFixed(2),
    unit: "",
    grade,
    pct: Math.max(0, Math.min(100, Math.round((Math.min(nlr, 5) / 5) * 100))),
  };
}

/** HbA1c → eAG (avg glucosis): eAG mg/dL = 28.7*A1c − 46.7; mmol/L = mg/dL / 18 */
function metric_A1c_eAG(measIndex) {
  const a1c = resolve(measIndex, [
    "hba1c", "hb a1c", "hb a1c en unite ifcc", "гликированный гемоглобин", "глікозильований гемоглобін"
  ]);
  const val = num(a1c?.value);
  if (val == null) return null;

  const eAG_mgdl = 28.7 * val - 46.7;
  const eAG_mmol = eAG_mgdl / 18;

  let grade = "Optimal";
  if (val >= 6.5) grade = "Diabetic risk";
  else if (val >= 5.7) grade = "Prediabetes risk";

  return {
    name: "Glycemic control",
    label: `eAG ≈ ${eAG_mgdl.toFixed(0)} mg/dL (${eAG_mmol.toFixed(1)} mmol/L)`,
    value: `${val.toFixed(1)} %`,
    unit: "",
    grade,
    pct: Math.max(0, Math.min(100, Math.round((Math.max(4, Math.min(val, 9)) - 4) / 5 * 100))),
  };
}

/* -------------------- UI PANELS -------------------- */

function Donut({ pct }) {
  return (
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
          strokeDasharray={`${pct}, 100`} transform="rotate(-90 18 18)"
        />
        <text x="18" y="20.5" textAnchor="middle" className="text-sm font-semibold fill-current">
          {pct}%
        </text>
      </svg>
    </div>
  );
}

/* -------------------- COMPONENT -------------------- */

export default function CompositePanels({ measurements, demographics }) {
  const measIndex = indexMeasurements(measurements);

  const cards = [];

  // Kidneys
  const egfr = metric_eGFR(measIndex, demographics);
  if (egfr) cards.push(egfr);

  // Liver
  const fib4 = metric_FIB4(measIndex, demographics);
  if (fib4) cards.push(fib4);

  const deritis = metric_DeRitis(measIndex);
  if (deritis) cards.push(deritis);

  // Lipids
  const aip = metric_AIP(measIndex);
  if (aip) cards.push(aip);

  const lipidRatios = metric_LipidRatios(measIndex);
  cards.push(...lipidRatios);

  // Inflammation
  const nlr = metric_NLR(measIndex);
  if (nlr) cards.push(nlr);

  // Glycemic control
  const a1c = metric_A1c_eAG(measIndex);
  if (a1c) cards.push(a1c);

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
            <Donut pct={c.pct ?? 0} />
          </div>
        ))}
      </div>
      <div className="text-xs opacity-70 mt-4">
        *Calculations are for informational purposes only and are not a diagnosis. Units are converted automatically.
      </div>
    </section>
  );
}