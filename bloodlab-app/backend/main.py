import os
import io
import json
import base64
import re
import unicodedata
from typing import List, Dict, Any, Tuple, Optional
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai

from PIL import Image
import pypdfium2 as pdfium
from starlette.responses import StreamingResponse

from openai import OpenAI
from settings import settings

# Config SDK from .env
genai.configure(api_key=settings.GOOGLE_API_KEY)
MODEL_NAME = settings.GENAI_MODEL

DB_PATHS = [
    settings.METRICS_DB or os.path.join(os.path.dirname(__file__), "data", "bloodlab_metrics_db_with_groups.json"),
    os.path.join(os.path.dirname(__file__), "bloodlab_metrics_db_with_groups.json"),
]

openai_client = OpenAI(api_key=settings.OPENAI_API_KEY) if settings.OPENAI_API_KEY else None

# ---------- schema ----------
class Measurement(BaseModel):
    name: str
    value: str
    unit: str | None = None
    reference_text: str | None = None
    ref_low: float | None = None
    ref_high: float | None = None
    flag: str | None = None
    source_file: str | None = None
    page: int | None = None
    group: str | None = None

class ParseResponse(BaseModel):
    measurements: List[Measurement]
    notes: str | None = None

class SummaryRequest(BaseModel):
    report: ParseResponse
    locale: Optional[str] = "ru"

class SummaryResponse(BaseModel):
    summary_md: str
    model: str = "gpt-4o-mini"


SUMMARY_SYSTEM = """
You are a clinical assistant for interpreting laboratory test results.  
You must strictly focus on blood tests and related laboratory parameters.  
Do not discuss any other topics.  
Base your interpretation on the provided database of parameters (names, measurement units, reference ranges, notes).  
Always formulate interpretations clearly and in a structured way.  
Do not provide a final diagnosis.  
Risks and recommendations should only be expressed as probabilistic assumptions.  

The output language must be according to the next messages.  

Format the output strictly in Markdown using the following template:
YOU CAN FREELY SKIP THE SECTIONS (EVEN DONT MENTION THEM) IF NO RELEVANT PARAMETERS ARE PRESENT IN THE DATA!

# 🧪 Blood Test Summary (SKIP IF NO RELEVANT PARAMETERS ARE PRESENT IN THE DATA)
**Patient:** [Name / ID]  
**Date of Analysis:** [DD.MM.YYYY]  
**Age / Gender:** [number / M / F]  

---

## 🔹 Complete Blood Count (CBC) (SKIP IF NO RELEVANT PARAMETERS ARE PRESENT IN THE DATA)
- **Hemoglobin (Hb):** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal)
- **Red Blood Cells (RBC):** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal) 
- **White Blood Cells (WBC):** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal)  
- **Platelets (PLT):** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal)  
- **Hematocrit (Hct):** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal)  

---

## 🔹 Biochemistry (SKIP IF NO RELEVANT PARAMETERS ARE PRESENT IN THE DATA)
- **Glucose:** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal)  
- **Creatinine:** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal)  
- **ALT / AST:** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal)  
- **Total Bilirubin:** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal)  
- **Cholesterol (total):** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal)  

---

## 🔹 Electrolytes (SKIP IF NO RELEVANT PARAMETERS ARE PRESENT IN THE DATA)
- **Na⁺ (Sodium):** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal)  
- **K⁺ (Potassium):** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal) 
- **Ca²⁺ (Calcium):** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal)  

---

## 🔹 Coagulation Panel (SKIP IF NO RELEVANT PARAMETERS ARE PRESENT IN THE DATA)
- **INR:** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal) 
- **Fibrinogen:** [value, reference] → shortly describe and CHOOSE ONE OF THESE EMOJIS: ✅ (normal), ⚠️ (borderline), ❌ (abnormal) 

---

## 📊 Final Summary (YOU CANNOT SKIP THIS SECTION)
Here, give a general outline of the patient's situation, highlight the most critical indicators and their potential explanation, and provide basic recommendations for stabilizing them and contacting a doctor, if necessary.

AND REMEMBER: USE ONLY THE PROVIDED LANGUAGE FOR YOUR OUTPUT (ALL NAMES AND TERMS HAVE TO BE TRANSLATED)!
YOU CAN FREELY SKIP THE SECTIONS IF NO RELEVANT PARAMETERS ARE PRESENT IN THE DATA!
ALSO IMPORTANT DETAIL: FOCUS ON DIFFERENT EXPLANATIONS OF DEVIATIONS (LIKE, IF YOU HAVE NORMAL VALUES FOR ABSOLUTE VALUES, BUT HIGH PERCENTAGE)

YOUR PATIENT:
"""

# ---------- CONFIG ----------
app = FastAPI(title="BloodLab Interpreter API", version="1.4")

allow_origins = ["*"] if settings.CORS_ORIGINS.strip() == "*" else [
    o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- helpers: numbers/refs ----------
def _to_float(x) -> Optional[float]:
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(",", ".")
    m = re.search(r"[-+]?\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else None

def value_to_number(val_str: Optional[str]) -> Optional[float]:
    if not val_str:
        return None
    s = str(val_str).replace(",", ".")
    m = re.search(r"[-+]?\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else None

def parse_ref_string_to_bounds(ref_str: Optional[str]) -> Tuple[Optional[float], Optional[float]]:
    if not ref_str:
        return (None, None)
    s = str(ref_str).strip().replace(",", ".")
    m = re.search(r"([-+]?\d+(?:\.\d+)?)\s*(?:-|–|—)\s*([-+]?\d+(?:\.\d+)?)", s)
    if m:
        return (float(m.group(1)), float(m.group(2)))
    m = re.search(r"(?:≤|<|⩽|≦)\s*([-+]?\d+(?:\.\d+)?)", s)
    if m:
        return (None, float(m.group(1)))
    m = re.search(r"(?:≥|>|⩾|≧)\s*([-+]?\d+(?:\.\d+)?)", s)
    if m:
        return (float(m.group(1)), None)
    return (None, None)

def compute_flag(value: Optional[float], low: Optional[float], high: Optional[float]) -> Optional[str]:
    if value is None:
        return "unknown"
    if low is not None and value < low:
        return "low"
    if high is not None and value > high:
        return "high"
    if low is None and high is None:
        return "unknown"
    return "normal"

def ref_string_looks_plausible(s: Optional[str]) -> bool:
    if not s:
        return False
    t = str(s).strip()
    if t.lower() in {"—", "-", "--", "— —", "none", "null", ""}:
        return False
    return bool(re.search(r"\d", t))

def is_empty_value(v: Optional[str]) -> bool:
    if v is None:
        return True
    t = str(v).strip().lower()
    return t in {"", "—", "-", "--", "none", "null", "n/a", "na"}

# ---------- name normalization / fuzzy ----------
SECTION_BLACKLIST = {
    "biochimie", "biochemistry", "hématologie", "hematology", "hématologie complète",
    "résultats", "resultats", "results", "donnees biométriques", "données biométriques",
    "biométrie", "biometrique", "patient", "référence", "reference", "unités", "unites",
    "microbiologie", "serologie", "sérologie", "иммунология"
}

def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))

def normalize_name(s: str) -> str:
    s = strip_accents(s).lower()
    s = re.sub(r"[%\(\)\[\]\{\}:;,/\\]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def levenshtein(a: str, b: str, limit: int = 2) -> int:
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    m, n = len(a), len(b)
    if m == 0: return n
    if n == 0: return m
    prev = list(range(n + 1))
    for i in range(1, m + 1):
        cur = [i] + [0] * n
        ca = a[i - 1]
        min_row = cur[0]
        for j in range(1, n + 1):
            cost = 0 if ca == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if cur[j] < min_row:
                min_row = cur[j]
        if min_row > limit:
            return limit + 1
        prev = cur
    return prev[-1]

# ---------- DB & synonyms ----------
DB: Dict[str, Any] = {}
CANON_BY_ALIAS: Dict[str, str] = {}
ALL_ALIASES_NORM: Dict[str, str] = {}  # normalized alias -> canonical
REF_BY_CANON: Dict[str, Dict[str, Any]] = {}

def load_db():
    global DB, CANON_BY_ALIAS, ALL_ALIASES_NORM, REF_BY_CANON
    for p in DB_PATHS:
        try:
            if os.path.exists(p):
                with open(p, "r", encoding="utf-8") as f:
                    DB = json.load(f)
                break
        except Exception:
            pass
    if not DB:
        DB = {"metrics": []}

    CANON_BY_ALIAS.clear()
    ALL_ALIASES_NORM.clear()
    REF_BY_CANON.clear()

    for m in DB.get("metrics", []):
        canon = m.get("canonical_name") or ""
        if not canon:
            continue
        aliases = set()
        names = m.get("names", {})
        for v in names.values():
            if v:
                aliases.add(str(v).strip())
        for a in m.get("aliases", []) or []:
            if a:
                aliases.add(str(a).strip())
        aliases.add(canon)

        for a in aliases:
            CANON_BY_ALIAS[a.strip().lower()] = canon
            ALL_ALIASES_NORM[normalize_name(a)] = canon

        REF_BY_CANON[canon] = {
            "unit": m.get("unit"),
            "reference_text": m.get("reference"),
            "notes": m.get("notes"),
            "group": m.get("group") or "Other",
        }

load_db()

def canon_name_soft(raw: str) -> Tuple[Optional[str], str]:
    if not raw:
        return (None, "")
    raw_clean = raw.strip()
    key_lower = raw_clean.lower()
    if key_lower in CANON_BY_ALIAS:
        return (CANON_BY_ALIAS[key_lower], normalize_name(raw_clean))

    raw_norm = normalize_name(raw_clean)
    if raw_norm in ALL_ALIASES_NORM:
        return (ALL_ALIASES_NORM[raw_norm], raw_norm)

    for alias_norm, canon in ALL_ALIASES_NORM.items():
        if len(alias_norm) >= 4 and (alias_norm in raw_norm or raw_norm in alias_norm):
            return (canon, raw_norm)

    best = (None, 3)
    for alias_norm, canon in ALL_ALIASES_NORM.items():
        d = levenshtein(raw_norm, alias_norm, limit=2)
        if d <= 2 and d < best[1]:
            best = (canon, d)
            if d == 0:
                break
    return (best[0], raw_norm)

def is_section_header(name: str) -> bool:
    if not name:
        return True
    n = normalize_name(name)
    return n in SECTION_BLACKLIST

# ===== leukocyte variants handling =====
WBC_BASE = {"neutrophils", "lymphocytes", "monocytes", "eosinophils", "basophils"}

def _is_percent_variant(name: str, unit: Optional[str], ref_text: Optional[str]) -> bool:
    n = name.lower()
    u = (unit or "").lower()
    if "%" in n or "%" in u or "segmented" in n:
        return True
    if ref_text:
        lo, hi = parse_ref_string_to_bounds(ref_text)
        if (lo is not None and hi is not None) and 0 <= lo < 100 and 0 < hi <= 100:
            return True
    return False

def _is_absolute_variant(name: str, unit: Optional[str]) -> bool:
    n = name.lower()
    u = (unit or "").lower()
    if "absolute" in n:
        return True
    if any(tok in u for tok in ["g/l", "10^9", "10^3", "/ul", "µl", "u/l"]):
        return True
    return False

def adjust_wbc_canonical(base_canon: str, unit: Optional[str], ref_text: Optional[str], raw_name: str) -> str:
    base_norm = normalize_name(base_canon)
    root = base_norm.split()[-1]
    if root not in WBC_BASE:
        return base_canon
    if _is_percent_variant(raw_name, unit, ref_text):
        return f"{base_canon} %"
    if _is_absolute_variant(raw_name, unit):
        return f"{base_canon} absolute"
    return base_canon

def get_db_entry(canon: str) -> Dict[str, Any]:
    if canon in REF_BY_CANON:
        return REF_BY_CANON[canon]
    base = canon.replace(" %", "").replace(" absolute", "").strip()
    return REF_BY_CANON.get(base, {})

def leukocyte_dedup_key(m: "Measurement") -> str:
    name_norm = normalize_name(m.name)
    base = name_norm.replace(" percent", "").replace("%", "").replace(" absolute", "").strip()
    if base.split()[-1] in WBC_BASE:
        var = "pct" if _is_percent_variant(m.name, m.unit, m.reference_text) else \
              "abs" if _is_absolute_variant(m.name, m.unit) else "base"
        return f"{base}|{var}"
    return name_norm

# ---------- OCR prompt ----------
SINGLE_PAGE_PROMPT = r"""
You are a medical assistant specialized in extracting laboratory data from reports.  
Your task: READ the provided image or PDF page and extract ALL laboratory measurements.  
Return the result STRICTLY as valid JSON following this schema:

{
  "measurements": [
    {
      "name": "<test name as written (Latin, French, English, or Russian)>",
      "value": "<numeric or string value exactly as printed>",
      "unit": "<unit of measurement or null>",
      "ref_low": <lower reference limit or null>,
      "ref_high": <upper reference limit or null>,
      "flag": "<low|normal|high|unknown>",
      "source_file": "<file name>",
      "page": <page number starting from 1>
      "group": CHOOSE ONE OF THESE GROUPS IF POSSIBLE: Hematologie, Biochimie, Electrolytes, Serologie, Microbiologie, Biometric data, Vaccination info, Other
    }
  ],
  "notes": "<short notes if needed>"
}

Strict rules:
1. Do NOT invent or add values that are not explicitly present on the page.  
2. Use exactly the names and values as they appear on the report.  
3. If reference ranges are present (e.g., "4.30 - 5.90"), store them in ref_low and ref_high as numbers with a dot.  
4. If a value is outside the reference range, set flag=low or flag=high.  
   If reference ranges are missing, set flag=unknown.  
5. Always keep measurement units exactly as printed (e.g., g/L, g/dL, 10^9/L).  
6. Return ONLY valid JSON — no Markdown, no explanations, no extra text.  
7. Pay close attention to digits and characters (0 vs O, 1 vs l, comma vs dot).  
8. For tables or multi-value rows, parse line by line and separate values correctly.  

Double-check that the JSON is syntactically valid and contains no extra characters.
"""

# ---------- IO utils ----------
def image_bytes_to_part(img_bytes: bytes, mime: str = "image/png") -> Dict[str, Any]:
    return {"mime_type": mime, "data": base64.b64encode(img_bytes).decode("utf-8")}

def pdf_to_images(pdf_bytes: bytes) -> list[bytes]:
    images = []
    pdf = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    n_pages = len(pdf)
    for i in range(n_pages):
        page = pdf[i]
        pil_image = page.render(scale=2).to_pil()
        buf = io.BytesIO()
        pil_image.save(buf, format="PNG")
        images.append(buf.getvalue())
    return images

def normalize_flag(val: str | None) -> str | None:
    if not val:
        return None
    v = val.lower().strip()
    if v in {"low", "normal", "high", "unknown"}:
        return v
    if v in {"below", "decreased"}:
        return "low"
    if v in {"above", "increased"}:
        return "high"
    return "unknown"

def _clean_json_text(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.lstrip("`")
        if "\n" in t:
            t = t.split("\n", 1)[1]
        t = t.rsplit("```", 1)[0].strip()
    return t

# ---------- post-OCR pipeline ----------
def enrich_with_db(m: "Measurement", canonical: Optional[str]) -> "Measurement":
    """
    Enrich Measurement using DB (units, refs) without затирания уже найденных границ.
    """
    if canonical:
        canonical = adjust_wbc_canonical(canonical, m.unit, m.reference_text, m.name)
        m.name = canonical
        in_db = True
        db_entry = get_db_entry(canonical)
        if not m.group:
            m.group = db_entry.get("group") or "Other"
    else:
        m.name = m.name.strip()
        in_db = False

    # unit from DB if missing
    if in_db and not m.unit:
        db_unit = get_db_entry(m.name).get("unit")
        if db_unit:
            m.unit = db_unit

    # reference_text: if name in DB and ref_text looks implausible, take from DB
    if in_db and not ref_string_looks_plausible(m.reference_text):
        m.reference_text = get_db_entry(m.name).get("reference_text")

    # if still no ref bounds, try to parse from reference_text
    if not (m.ref_low is not None or m.ref_high is not None):
        if m.reference_text:
            m.ref_low, m.ref_high = parse_ref_string_to_bounds(m.reference_text)

    # recompute flag if possible
    val_num = value_to_number(m.value)
    if (val_num is not None) and (m.ref_low is not None or m.ref_high is not None):
        m.flag = compute_flag(val_num, m.ref_low, m.ref_high)
    else:
        m.flag = normalize_flag(m.flag)

    return m

def score_entry(m: "Measurement") -> int:
    s = 0
    if value_to_number(m.value) is not None:
        s += 4
    if m.reference_text:
        s += 3
    if (m.ref_low is not None) or (m.ref_high is not None):
        s += 2
    if m.unit:
        s += 1
    if m.flag and m.flag != "unknown":
        s += 1
    return s

# ---------- page processing ----------
def _compose_reference_text(ref_low: Optional[float], ref_high: Optional[float]) -> Optional[str]:
    if ref_low is None and ref_high is None:
        return None
    if ref_low is not None and ref_high is not None:
        return f"{ref_low:g} – {ref_high:g}"
    if ref_high is not None:
        return f"≤ {ref_high:g}"
    return f"≥ {ref_low:g}"

def process_single_page(model, image_bytes: bytes, filename: str, page_num: int) -> List["Measurement"]:
    parts = [{"text": SINGLE_PAGE_PROMPT}, image_bytes_to_part(image_bytes, "image/png")]
    try:
        resp = model.generate_content(parts)
        text = resp.text or ""
    except Exception as e:
        print(f"OCR error for {filename}, page {page_num}: {e}")
        return []
    

    # 🔹 Logging raw text after OCR
    """
    raw_log_path = f"logs/{filename.replace('/', '_')}_p{page_num}_raw.txt"
    os.makedirs(os.path.dirname(raw_log_path), exist_ok=True)
    with open(raw_log_path, "w", encoding="utf-8") as f:
        f.write(text)
    """
    text_clean = _clean_json_text(text)

    # 🔹 Logging clean text (after _clean_json_text)
    """
    clean_log_path = f"logs/{filename.replace('/', '_')}_p{page_num}_clean.txt"
    with open(clean_log_path, "w", encoding="utf-8") as f:
        f.write(text_clean)
    """
    try:
        data_json = json.loads(text_clean)
    except Exception as e:
        print(f"JSON parsing error for {filename}, page {page_num}: {e}")
        try:
            fixer = genai.GenerativeModel(MODEL_NAME)
            fix_prompt = "Convert the following text into strictly valid JSON. Return ONLY JSON:\n" + text_clean
            fix_resp = fixer.generate_content([{"text": fix_prompt}])
            data_json = json.loads(_clean_json_text(fix_resp.text or ""))
        except Exception:
            print(f"Failed to fix JSON for {filename}, page {page_num}")
            return []

    out: List[Measurement] = []
    for item in data_json.get("measurements", []):
        raw_name = str(item.get("name", "")).strip()
        if not raw_name:
            continue
        if is_section_header(raw_name):
            continue

        raw_value = str(item.get("value", "")).strip()
        if is_empty_value(raw_value):
            continue

        # Границы могут прийти прямо из OCR
        item_ref_low = _to_float(item.get("ref_low"))
        item_ref_high = _to_float(item.get("ref_high"))

        # Собираем reference_text, если OCR не дал строку
        reference_text = item.get("reference_text")
        if not ref_string_looks_plausible(reference_text):
            reference_text = _compose_reference_text(item_ref_low, item_ref_high)

        canonical, _ = canon_name_soft(raw_name)

        grp = item.get("group")
        if isinstance(grp, str):
            grp = grp.strip()

        m = Measurement(
            name=canonical or raw_name,
            value=raw_value,
            unit=(item.get("unit") or None),
            reference_text=reference_text,
            ref_low=item_ref_low,
            ref_high=item_ref_high,
            flag=normalize_flag(item.get("flag")),
            source_file=filename,
            page=page_num,
            group=grp,
        )
        m = enrich_with_db(m, canonical)
        out.append(m)

    return out

# ---------- expand files to pages ----------
def expand_files_to_pages(files_payload: List[Tuple[str, Optional[str], bytes, int]]) -> List[Tuple[str, int, bytes]]:
    pages: List[Tuple[str, int, bytes]] = []
    for filename, content_type, raw, file_idx in files_payload:
        sf = f"{filename}#{file_idx}"
        if (content_type and "pdf" in (content_type.lower())) or filename.lower().endswith(".pdf"):
            try:
                imgs = pdf_to_images(raw)
                for idx, img_bytes in enumerate(imgs, start=1):
                    pages.append((sf, idx, img_bytes))
            except Exception as e:
                print(f"PDF processing error {filename}: {e}")
                continue
        else:
            try:
                img = Image.open(io.BytesIO(raw)).convert("RGB")
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                pages.append((sf, 1, buf.getvalue()))
            except Exception as e:
                print(f"Image processing error {filename}: {e}")
                continue
    return pages

# ---------- API: non-stream ----------

@app.get("/api/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "openai": bool(openai_client)}

@app.post("/api/process", response_model=ParseResponse)
async def process(files: List[UploadFile] = File(...)):
    model = genai.GenerativeModel(MODEL_NAME)

    mem_files: list[tuple[str, Optional[str], bytes, int]] = []
    for idx, f in enumerate(files, start=1):
        raw = await f.read()
        mem_files.append((f.filename or "file", f.content_type, raw, idx))

    pages = expand_files_to_pages(mem_files)
    if not pages:
        return ParseResponse(measurements=[], notes="Failed to process any files")

    all_measurements: List[Measurement] = []
    for filename, page_num, image_bytes in pages:
        items = process_single_page(model, image_bytes, filename, page_num)
        all_measurements.extend(items)
        print(f"Processed file {filename}, page {page_num}: found {len(items)} measurements")

    best: Dict[str, Measurement] = {}
    for m in all_measurements:
        key = leukocyte_dedup_key(m)
        if key not in best or score_entry(m) > score_entry(best[key]):
            best[key] = m

    results = list(best.values())
    return ParseResponse(measurements=results, notes=f"Processed {len(pages)} pages")

# ---------- API: stream with progress ----------
def _sse(event: str, data: Dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")

@app.post("/api/process/stream")
async def process_stream(files: List[UploadFile] = File(...)):
    model = genai.GenerativeModel(MODEL_NAME)

    mem_files: list[tuple[str, Optional[str], bytes, int]] = []
    for idx, f in enumerate(files, start=1):
        raw = await f.read()
        mem_files.append((f.filename or "file", f.content_type, raw, idx))

    pages = expand_files_to_pages(mem_files)
    total_pages = len(pages)

    async def event_gen():
        yield _sse("meta", {"total_steps": total_pages})
        yield _sse("progress", {"step": 0, "total": total_pages, "percent": 0})

        all_measurements: List[Measurement] = []

        for idx, (filename, page_num, image_bytes) in enumerate(pages, start=1):
            try:
                items = process_single_page(model, image_bytes, filename, page_num)
                all_measurements.extend(items)

                yield _sse("page", {
                    "filename": filename,
                    "page": page_num,
                    "items": [m.model_dump() for m in items],
                })

                percent = int(idx * 100 / max(1, total_pages))
                yield _sse("progress", {"step": idx, "total": total_pages, "percent": percent})
                yield b": keep-alive\n\n"
            except Exception as e:
                yield _sse("progress", {"error": f"Processing error {filename}, page {page_num}: {e}"})

        best: Dict[str, Measurement] = {}
        for m in all_measurements:
            key = leukocyte_dedup_key(m)
            if key not in best or score_entry(m) > score_entry(best[key]):
                best[key] = m

        final_measurements = list(best.values())
        yield _sse("done", ParseResponse(
            measurements=final_measurements,
            notes=f"Processed {total_pages} pages"
        ).model_dump())

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@app.post("/api/summary", response_model=SummaryResponse)
def api_summary(req: SummaryRequest):
    if openai_client is None:
        return SummaryResponse(summary_md="OpenAI API key is not configured on the server (.env OPENAI_API_KEY).", model="gpt-4o-mini")
    try:
        db_json = json.dumps(DB, ensure_ascii=False)
        report_json = json.dumps(req.report.model_dump(), ensure_ascii=False)

        locale = (req.locale or "ru").strip().lower()
        if locale not in ("ru", "en", "ua"):
            locale = "ru"

        user_prompt = (
            f"Response language: {locale}.\n"
            "Given:\n"
            "1) Full parameter database (JSON):\n"
            f"{db_json}\n\n"
            "2) Final extracted report (JSON):\n"
            f"{report_json}\n\n"
            "GENERATE REPORT ACCORDING TO THE SYSTEM INSTRUCTIONS ABOVE AND USING CHOSEN LANGUAGE ONLY.\n"
        )

        resp = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": SUMMARY_SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )

        text = resp.choices[0].message.content if resp.choices else ""
        return SummaryResponse(summary_md=text or "", model="gpt-4o-mini")
    except Exception as e:
        return SummaryResponse(summary_md=f"Summary generation error: {e}", model="gpt-4o-mini")