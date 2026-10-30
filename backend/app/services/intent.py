"""Intent + parameter extraction. Rule-based parser is the authority for amounts; an optional Sarvam
LLM result is treated as an untrusted candidate and validated against these rules."""

import difflib
import re
from dataclasses import dataclass, field
from decimal import Decimal

HINDI_NUMBERS = {
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5, "chhe": 6, "chhah": 6,
    "saat": 7, "aath": 8, "nau": 9, "das": 10, "bees": 20, "pachees": 25, "tees": 30, "chalees": 40,
    "pachaas": 50, "pachas": 50, "pachpan": 55, "saath": 60, "sattar": 70, "assi": 80, "nabbe": 90,
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "twenty": 20, "fifty": 50,
}
MULTIPLIERS = {"hazaar": 1000, "hazar": 1000, "hajar": 1000, "thousand": 1000, "k": 1000,
               "sau": 100, "hundred": 100, "lakh": 100000, "lac": 100000}

RESTOCK_WORDS = ("stock", "restock", "saman", "samaan", "maal", "order", "kharid", "inventory", "weekend")
COLLECT_WORDS = ("payment", "dues", "due", "udhaar", "udhar", "collect", "paisa", "paise", "pending", "baki", "baaki")
BRIEF_WORDS = ("aaj", "important", "brief", "report", "summary", "kya chal", "today", "priorities")


@dataclass
class ParsedIntent:
    intent: str  # RESTOCK | COLLECT_DUE | BRIEF | UNKNOWN
    budget: Decimal | None = None
    budget_from_words: bool = False
    customer: str | None = None
    horizon_days: int = 7
    confidence: str = "high"
    notes: list[str] = field(default_factory=list)

    @property
    def needs_budget_confirmation(self) -> bool:
        return self.budget is not None and (self.budget_from_words or self.confidence != "high")


def parse_amount(text: str) -> tuple[Decimal | None, bool]:
    """Returns (amount, from_words). Handles ₹5,000 / 5000 / 5k / 5 hazaar / paanch hazaar."""
    t = re.sub(r"\brs\.?(?=\s|\d)", " ₹ ", text.lower().replace("₹", " ₹ "))
    m = re.search(r"(\d[\d,]*(?:\.\d+)?)\s*(k|hazaar|hazar|hajar|thousand|lakh|lac|sau|hundred)?\b", t)
    if m:
        number = Decimal(m.group(1).replace(",", ""))
        mult = MULTIPLIERS.get(m.group(2) or "", 1)
        return number * mult, False
    tokens = re.findall(r"[a-z]+", t)
    for i, tok in enumerate(tokens):
        if tok in HINDI_NUMBERS:
            value = HINDI_NUMBERS[tok]
            if i + 1 < len(tokens) and tokens[i + 1] in MULTIPLIERS:
                return Decimal(value * MULTIPLIERS[tokens[i + 1]]), True
    return None, False


def match_customer(text: str, customers: list[str]) -> str | None:
    lowered = text.lower()
    for name in customers:
        first = name.lower().split()[0]
        if name.lower() in lowered or re.search(rf"\b{re.escape(first)}\b", lowered):
            return name
    words = re.findall(r"[a-z]+", lowered)
    firsts = {name.lower().split()[0]: name for name in customers}
    for w in words:
        close = difflib.get_close_matches(w, list(firsts), n=1, cutoff=0.85)
        if close:
            return firsts[close[0]]
    return None


def parse(text: str, customers: list[str]) -> ParsedIntent:
    lowered = text.lower()
    amount, from_words = parse_amount(text)
    customer = match_customer(text, customers)
    has = lambda words: any(re.search(rf"\b{re.escape(w)}", lowered) for w in words)  # noqa: E731

    if customer or (has(COLLECT_WORDS) and not has(RESTOCK_WORDS)):
        return ParsedIntent("COLLECT_DUE", customer=customer, notes=[] if customer else ["Which customer?"])
    if has(RESTOCK_WORDS):
        horizon = 3 if re.search(r"\b(sirf|only)\s+weekend\b", lowered) else 7
        parsed = ParsedIntent("RESTOCK", budget=amount, budget_from_words=from_words, horizon_days=horizon)
        if amount is None:
            parsed.notes.append("Budget missing")
        return parsed
    if has(BRIEF_WORDS):
        return ParsedIntent("BRIEF")
    return ParsedIntent("UNKNOWN", confidence="low")


def merge_llm_candidate(rule: ParsedIntent, candidate: dict) -> ParsedIntent:
    """LLM output is untrusted: only fills gaps, never overrides a rule-parsed amount, values are validated."""
    if rule.intent == "UNKNOWN" and candidate.get("intent") in ("RESTOCK", "COLLECT_DUE", "BRIEF"):
        rule.intent = candidate["intent"]
        rule.confidence = "medium"
    if rule.intent == "RESTOCK" and rule.budget is None:
        try:
            value = Decimal(str(candidate.get("budget")))
            if Decimal("100") <= value <= Decimal("500000"):
                rule.budget = value.quantize(Decimal("1"))
                rule.confidence = "medium"  # forces on-screen confirmation
        except Exception:  # noqa: BLE001 - any malformed candidate is ignored
            pass
    return rule
