# backend/settings.py
from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    GOOGLE_API_KEY: str = Field(..., min_length=10)   # Gemma/Gemini key
    OPENAI_API_KEY: str | None = None                 # OpenAI
    GENAI_MODEL: str = "gemma-3-27b-it"               # default model for OCR
    METRICS_DB: str | None = None                     # DB path
    CORS_ORIGINS: str = "*"                           # CORS policy

    class Config:
        env_file = ".env"       #locally
        extra = "ignore"

settings = Settings()
