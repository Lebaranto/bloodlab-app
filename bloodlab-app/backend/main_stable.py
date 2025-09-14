import os
import io
import json
import base64
from typing import List, Dict, Any
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai

from PIL import Image
import pypdfium2 as pdfium

# ---------- CONFIG ----------
GOOGLE_API_KEY = "AIzaSyCP5VeloqVYtZib4FA-HWNZJWfRsRmxvtU"

genai.configure(api_key=GOOGLE_API_KEY)

# Use Gemma 3 with vision
MODEL_NAME = os.getenv("GENAI_MODEL", "gemma-3-27b-it")

app = FastAPI(title="BloodLab Interpreter API", version="1.0")

# CORS for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import re

def _to_float(x) -> float | None:
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(",", ".")
    m = re.search(r"[-+]?\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else None

def clean_bound(val, is_low: bool) -> float | None:
    """
    Приводит строки вида '< 10', '≤5', '>7', '4.3 - 5.9' к числу.
    - Для low-границы при '<N' вернём None (нижняя граница не задана),
      для high-границы при '<N' вернём N.
    - Для '>N' наоборот: low=N, high=None.
    - Для диапазона 'A - B': low=A (is_low=True), high=B (is_low=False).
    """
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)

    s = str(val).strip().replace(",", ".")
    # Диапазон "A - B"
    nums = re.findall(r"[-+]?\d+(?:\.\d+)?", s)
    if " - " in s or "–" in s or "—" in s:
        if nums:
            return float(nums[0] if is_low else nums[-1])

    # Неравенства
    if any(sym in s for sym in ["<", "≤", "⩽", "≦"]):
        return None if is_low else _to_float(s)
    if any(sym in s for sym in [">", "≥", "⩾", "≧"]):
        return _to_float(s) if is_low else None

    # Обычное число
    return _to_float(s)




class Measurement(BaseModel):
    name: str
    value: str
    unit: str | None = None
    ref_low: float | None = None
    ref_high: float | None = None
    flag: str | None = None
    source_file: str | None = None
    page: int | None = None

class ParseResponse(BaseModel):
    measurements: List[Measurement]
    notes: str | None = None

SYSTEM_PROMPT = r"""
Ты — медицинский ассистент по интерпретации лабораторных анализов. 
Твоя задача: ВЫДЕЛИТЬ значения лабораторных показателей из предоставленного изображения или PDF-страниц, 
и вернуть СТРОГО валидный JSON по схеме:

{
  "measurements": [
    {
      "name": "<латинское или французское/английское/русское название показателя>",
      "value": "<число или строка как напечатано>",
      "unit": "<единицы измерения или null>",
      "ref_low": <нижняя граница нормы или null>,
      "ref_high": <верхняя граница нормы или null>,
      "flag": "<low|normal|high|unknown>",
      "source_file": "<имя файла>",
      "page": <номер страницы, начиная с 1>
    }
  ],
  "notes": "<краткие примечания, если нужно>"
}

Правила:
- Не придумывай значения, которых нет. 
- Значения референсов бери ТОЛЬКО с бланка, если указаны (пример «4.30 - 5.90» → ref_low=4.3, ref_high=5.9).
- Если значение вне референса — проставь flag=low/ high. Если оценить невозможно — flag=unknown.
- Сохраняй исходные единицы (г/л, g/L, 10^9/L и т.п.).
- Возвращай ТОЛЬКО JSON без пояснений, без форматирования Markdown.
"""

def image_bytes_to_part(img_bytes: bytes, mime: str = "image/png") -> Dict[str, Any]:
    return {"mime_type": mime, "data": base64.b64encode(img_bytes).decode("utf-8")}

def pdf_to_images(pdf_bytes: bytes) -> list[bytes]:
    """Render PDF bytes to a list of PNG bytes using pypdfium2."""
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
    # Map common variants
    if v in {"below", "decreased"}:
        return "low"
    if v in {"above", "increased"}:
        return "high"
    return "unknown"

@app.post("/api/process", response_model=ParseResponse)
async def process(files: List[UploadFile] = File(...)):
    model = genai.GenerativeModel(MODEL_NAME)
    all_measurements: list[Measurement] = []

    for file in files:
        filename = file.filename or "file"
        data = await file.read()
        content_parts = [{"text": SYSTEM_PROMPT}]

        if (file.content_type and "pdf" in file.content_type.lower()) or filename.lower().endswith(".pdf"):
            try:
                images = pdf_to_images(data)
                for idx, img in enumerate(images, start=1):
                    content_parts.append(image_bytes_to_part(img, "image/png"))
                    content_parts.append({"text": f"Файл: {filename}, страница {idx}"})
            except Exception:
                content_parts.append({"mime_type": "application/pdf", "data": base64.b64encode(data).decode("utf-8")})
                content_parts.append({"text": f"Файл: {filename}"})
        else:
            try:
                img = Image.open(io.BytesIO(data)).convert("RGB")
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                content_parts.append(image_bytes_to_part(buf.getvalue(), "image/png"))
            except Exception:
                content_parts.append({"mime_type": file.content_type or "application/octet-stream",
                                      "data": base64.b64encode(data).decode("utf-8")})
            content_parts.append({"text": f"Файл: {filename}, страница 1"})

        try:
            resp = model.generate_content(content_parts)
            text = resp.text
        except Exception as e:
            raise RuntimeError(f"GenAI error for {filename}: {e}")

        text_clean = text.strip()
        if text_clean.startswith("```"):
            text_clean = text_clean.strip("`")
            # remove possible language tag line
            if "\n" in text_clean:
                text_clean = text_clean.split("\n", 1)[1]

        try:
            data_json = json.loads(text_clean)
        except Exception:
            fixer = genai.GenerativeModel(MODEL_NAME)
            fix_prompt = f"Преобразуй следующий текст в строго валидный JSON по указанной схеме. Верни ТОЛЬКО JSON:\n{text_clean}"
            fix_resp = fixer.generate_content([{"text": fix_prompt}])
            data_json = json.loads(fix_resp.text)

        items = data_json.get("measurements", [])
        for it in items:
            m = Measurement(
                name=str(it.get("name", "")).strip(),
                value=str(it.get("value", "")).strip(),
                unit=(it.get("unit") or None),
                ref_low=clean_bound(it.get("ref_low"), is_low=True),
                ref_high=clean_bound(it.get("ref_high"), is_low=False),
                flag=normalize_flag(it.get("flag")),
                source_file=it.get("source_file") or filename,
                page=it.get("page") or 1,
            )
            all_measurements.append(m)

    def flag_rank(f: str | None) -> int:
        return {"high": 3, "low": 3, "normal": 2, "unknown": 1, None: 0}.get(f, 0)

    dedup: dict[tuple, Measurement] = {}
    for m in all_measurements:
        key = (m.name.lower(), m.unit or "")
        if key not in dedup or flag_rank(m.flag) > flag_rank(dedup[key].flag):
            dedup[key] = m

    result = ParseResponse(measurements=list(dedup.values()), notes="")
    return result