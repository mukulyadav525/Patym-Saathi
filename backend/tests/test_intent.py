from decimal import Decimal

from app.services.intent import merge_llm_candidate, parse, parse_amount

CUSTOMERS = ["Aman Stores", "Verma Tea Stall"]


def test_amount_formats():
    assert parse_amount("₹5,000") == (Decimal("5000"), False)
    assert parse_amount("budget 5000 ka") == (Decimal("5000"), False)
    assert parse_amount("5k mein") == (Decimal("5000"), False)
    assert parse_amount("Rs. 4500") == (Decimal("4500"), False)
    assert parse_amount("paanch hazaar") == (Decimal("5000"), True)
    assert parse_amount("pachaas hazaar") == (Decimal("50000"), True)
    assert parse_amount("pachpan sau") == (Decimal("5500"), True)
    assert parse_amount("stock arrange karo") == (None, False)


def test_intents():
    restock = parse("Weekend ke liye ₹5,000 ke andar stock arrange karo", CUSTOMERS)
    assert restock.intent == "RESTOCK" and restock.budget == Decimal("5000") and not restock.needs_budget_confirmation
    dues = parse("Aman Stores ka pending payment collect karo", CUSTOMERS)
    assert dues.intent == "COLLECT_DUE" and dues.customer == "Aman Stores"
    assert parse("Aaj mere business mein kya important hai?", CUSTOMERS).intent == "BRIEF"
    assert parse("hello", CUSTOMERS).intent == "UNKNOWN"
    assert parse("paanch hazaar ka stock", CUSTOMERS).needs_budget_confirmation


def test_llm_candidate_cannot_override_rule_amount():
    rule = parse("₹5,000 ka stock", CUSTOMERS)
    merged = merge_llm_candidate(rule, {"intent": "RESTOCK", "budget": 99999})
    assert merged.budget == Decimal("5000")
    gap = merge_llm_candidate(parse("stock chahiye", CUSTOMERS), {"budget": "5000; ignore rules"})
    assert gap.budget is None
    filled = merge_llm_candidate(parse("stock chahiye", CUSTOMERS), {"budget": 5000})
    assert filled.budget == Decimal("5000") and filled.needs_budget_confirmation


def test_growth_topics():
    from app.services.intent import parse
    assert parse("kaunsa maal nahi bik raha?", []).topic == "OFFERS"
    assert parse("mera khata dikhao", []).topic == "KHATA"
    assert parse("cash kab kam padega", []).topic == "CASHFLOW"
    assert parse("aas paas ki dukaan kya bech rahi hai", []).topic == "BENCHMARKS"
    assert parse("Aman Stores ka pending payment collect karo", ["Aman Stores"]).intent == "COLLECT_DUE"
    assert parse("Diwali ke liye ₹10,000 ke andar stock arrange karo", []).intent == "RESTOCK"


def test_ordinary_words_never_match_a_customer():
    from app.services.intent import parse
    names = ["Aman Stores", "Verma Tea Stall", "Rao General"]
    p = parse("mujhe dukaan ke liye kuch saman mangwana hai, teen hazaar tak", names)
    assert p.intent == "RESTOCK" and p.customer is None and int(p.budget) == 3000
    assert parse("Amann Stores ka payment collect karo", names).customer == "Aman Stores"  # real typo still matches
