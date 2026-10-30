"""Voice: wake word, answers from the merchant's own records, LLM number guard, speech output, STT request shape."""

import pytest

from app.adapters import sarvam
from app.services.assistant import strip_wake_word
from tests.conftest import login


def ask(client, auth, text, **extra):
    r = client.post("/api/v1/assistant/message", json={"text": text, **extra}, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("spoken,rest", [
    ("Hey Saathi, atta kitna bacha hai?", "atta kitna bacha hai?"),
    ("hey sathi aaj ka brief", "aaj ka brief"),
    ("Saathi! Aman ka kitna baaki hai", "Aman ka kitna baaki hai"),
    ("हे साथी आज क्या ज़रूरी है", "आज क्या ज़रूरी है"),
    ("atta kitna hai", "atta kitna hai"),
])
def test_wake_word_is_stripped(spoken, rest):
    assert strip_wake_word(spoken) == rest


def test_stock_question_answered_from_records(client, auth):
    r = ask(client, auth, "Hey Saathi, atta kitna bacha hai?")
    assert r["intent"] == "ANSWER" and "Atta: 2 packs" in r["reply"] and "ek hafte se kam" in r["reply"]


def test_customer_dues_question(client, auth):
    r = ask(client, auth, "Aman Stores ka kitna baaki hai?")
    assert r["intent"] == "ANSWER" and "₹1,200" in r["reply"] and "der se" in r["reply"] and "INV-1042" in r["reply"]


def test_sales_and_totals_questions(client, auth):
    assert "₹9,130" in ask(client, auth, "pichhle hafte kitni bikri hui?")["reply"]
    total = ask(client, auth, "kitna paisa baaki hai total?")["reply"]
    assert "₹1,850" in total
    assert "manzoori" in ask(client, auth, "kitne approvals pending hain?")["reply"]


def test_actions_still_go_to_workflows(client, auth):
    r = ask(client, auth, "Hey Saathi, weekend ke liye ₹5,000 ke andar stock arrange karo")
    assert r["intent"] == "RESTOCK" and r["task"]["plans"][-1]["total"] == "4650.00"
    r = ask(client, auth, "Saathi, Aman Stores ka pending payment collect karo")
    assert r["intent"] == "COLLECT_DUE" and r["task"]


def test_llm_answer_used_only_when_numbers_are_grounded(client, auth, monkeypatch):
    monkeypatch.setattr(sarvam, "enabled", lambda: True)
    monkeypatch.setattr(sarvam, "extract_intent", lambda _t: {})
    monkeypatch.setattr(sarvam, "chat", lambda *_a, **_k: "Sugar ke 8 packs hain aur har hafte 20 bikte hain.")
    r = ask(client, auth, "dukaan ka haal kaisa hai mausam ke hisaab se?")
    assert r["intent"] == "ANSWER" and "8 packs" in r["reply"]
    monkeypatch.setattr(sarvam, "chat", lambda *_a, **_k: "Aapki bikri ₹77,777 hai.")
    r = ask(client, auth, "dukaan ka haal kaisa hai mausam ke hisaab se?")
    assert r["intent"] == "UNKNOWN" and "77,777" not in r["reply"]


def test_llm_snapshot_is_merchant_scoped(client, auth, monkeypatch):
    seen = {}
    monkeypatch.setattr(sarvam, "enabled", lambda: True)
    monkeypatch.setattr(sarvam, "chat", lambda system, user, **_k: seen.setdefault("system", system) and None)
    ask(client, login(client, "owner@storeb.demo"), "dukaan kaisi chal rahi hai?")
    assert "Aman Stores" not in seen["system"] and "Test Store B" in seen["system"]


def test_devanagari_input_and_speech(client, auth, monkeypatch):
    monkeypatch.setattr(sarvam, "enabled", lambda: True)
    monkeypatch.setattr(sarvam, "romanize", lambda t: "atta kitna bacha hai?")
    monkeypatch.setattr(sarvam, "to_devanagari", lambda t: "देवनागरी: " + t)
    r = ask(client, auth, "आटा कितना बचा है?", speak=True)
    assert r["intent"] == "ANSWER" and r["transcript"] == "आटा कितना बचा है?"
    assert r["speech"].startswith("देवनागरी: Atta: 2 packs")
    assert ask(client, auth, "atta kitna bacha hai?")["speech"] is None  # only when asked


def test_brief_speech_includes_priorities(client, auth):
    r = ask(client, auth, "aaj mere business mein kya important hai?", speak=True)
    assert r["intent"] == "BRIEF" and "Aman Stores owes" in r["speech"]


@pytest.mark.parametrize("head,mime", [
    (b"\x00\x00\x00\x1cftypM4A ", "audio/mp4"), (b"RIFF\x00\x00\x00\x00WAVEfmt", "audio/wav"),
    (b"\x1aE\xdf\xa3\x01\x00", "audio/webm"), (b"OggS\x00", "audio/ogg"), (b"ID3\x03", "audio/mpeg"),
    (b"#!AMR\n", "audio/amr"), (b"garbage", "application/octet-stream"),
])
def test_audio_type_from_bytes(head, mime):
    assert sarvam.audio_mime(head + b"\x00" * 16, "audio/m4a") == mime


def test_transcribe_uses_hinglish_translit_and_sniffed_type(monkeypatch):
    sent = {}

    class Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"transcript": "Atta kitna bacha hai?"}

    def fake_post(url, **kw):
        sent.update(url=url, **kw)
        return Resp()

    monkeypatch.setattr(sarvam, "enabled", lambda: True)
    monkeypatch.setattr(sarvam.httpx, "post", fake_post)
    out = sarvam.transcribe(b"\x00\x00\x00\x1cftypM4A " + b"\x00" * 50, "voice.m4a", "audio/m4a", "unknown")
    assert out == "Atta kitna bacha hai?"
    assert sent["data"] == {"model": "saaras:v3", "language_code": "hi-IN", "mode": "translit"}
    assert sent["files"]["file"][2] == "audio/mp4"
