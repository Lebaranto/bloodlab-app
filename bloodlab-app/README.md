# BloodLab

> **AI-driven laboratory report interpreter** – Extracts data from lab test images/PDFs, normalizes values against a medical metrics database, generates structured tables, organ-level composite metrics, and concise AI-powered summaries.

![BloodLab Banner](docs/bloodlab_logo.svg)

---

## 🚀 Features

- **OCR & Parsing** – Extracts values from scanned lab reports and PDFs (multi-page supported).
- **Normalization** – Aligns values with a medical database, including reference ranges and aliases.
- **Structured Tables** – Displays extracted results with flags (`low`, `normal`, `high`) and highlights.
- **Grouped Views** – Organizes results by medical systems (hematology, liver, kidneys, etc.).
- **Composite Panels** – Calculates higher-level metrics (e.g., eGFR, De Ritis ratio, NLR, AIP, HbA1c→eAG).
- **AI Summaries** – GPT‑based summaries in **Russian** and **English**, rendered in Markdown.
- **JSON Export** – Download all processed results in structured JSON format.
- **Logging** – Saves raw OCR and parsed JSON for debugging and transparency.

---

## 🏗 Architecture

```
Frontend (React + Vite + Tailwind)
    ├─ UploadZone (OCR input)
    ├─ ResultsTable (per-measurement view)
    ├─ GroupedResults (grouped by organ/system)
    ├─ CompositePanels (computed metrics & charts)
    └─ AISummaryPanel (AI Markdown summary)

Backend (FastAPI + Python)
    ├─ OCR pipeline (Gemma-3 + Google Generative AI)
    ├─ Data normalization & enrichment (DB, aliases, reference ranges)
    ├─ Streaming API with SSE for progress updates
    └─ Summary generation (OpenAI GPT, locale-aware)

Database
    └─ JSON knowledge base of lab parameters, references, groups
```

---

## ⚡ Quickstart with Docker

### Prerequisites
- Docker & Docker Compose installed
- API keys available for Google Generative AI & OpenAI

### 1. Clone the repository
```bash
git clone https://github.com/<your-org>/bloodlab.git
cd bloodlab
```

### 2. Create `.env` files

Backend `.env`:
```env
GOOGLE_API_KEY=your_google_key
OPENAI_API_KEY=your_openai_key
GENAI_MODEL=gemma-3-27b-it
METRICS_DB=/app/data/bloodlab_metrics_db_with_groups.json
CORS_ORIGINS=http://localhost:3000
```

Frontend `.env`:
```env
VITE_API_BASE=http://localhost:8000
```

### 3. Run with Docker Compose
```bash
docker compose up --build
```

Backend → http://localhost:8000  
Frontend → http://localhost:3000

---

## 🛠 Tech Stack

**Frontend:** React, Vite, TailwindCSS, ReactMarkdown  
**Backend:** FastAPI, Pydantic, Google Generative AI, OpenAI API, PDFium, Pillow  
**Infrastructure:** Docker, Docker Compose  
**Data:** JSON-based metrics database

---

## 📈 Roadmap

- [ ] Extend metrics database with more aliases and qualitative tests
- [ ] Add multilingual UI (currently Russian-only)
- [ ] Extend composite metrics (lipid scores, cardiac risk, hormonal panels)
- [ ] Support for additional OCR models
- [ ] Deploy with HTTPS and production-ready monitoring

---

## 🤝 Contributing

We welcome contributions! Please open issues and pull requests.  
Make sure not to commit API keys or `.env` files.

---

## 📜 License

MIT License © 2025 BloodLab

