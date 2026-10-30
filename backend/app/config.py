from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    database_url: str = "postgresql+psycopg://localhost/paytm_saathi?host=/tmp"
    cors_origins: str = "http://localhost:3000,http://localhost:8081"

    # Auth: backend-issued JWT (HS256). Supabase JWT secret is accepted too when set.
    jwt_secret: str = "dev-only-change-me-0123456789abcdef"
    jwt_ttl_minutes: int = 720
    supabase_jwt_secret: str | None = None

    # Demo controls
    demo_mode: bool = True
    demo_shortage: bool = True
    demo_webhook_key: str = "dev-demo-webhook-key"
    demo_password: str = "saathi-demo-2026"
    restock_safety_packs: int = 0
    approval_ttl_minutes: int = 10

    # Paytm: demo | staging. Staging needs MID + merchant key.
    paytm_env: str = "demo"
    paytm_mid: str = "DEMOMID00000000000001"
    paytm_merchant_key: str | None = None

    # Sarvam (optional; text fallback when unset)
    sarvam_api_key: str | None = None
    sarvam_stt_model: str = "saarika:v2.5"
    sarvam_llm_model: str = "sarvam-m"
    sarvam_tts_model: str = "bulbul:v2"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
