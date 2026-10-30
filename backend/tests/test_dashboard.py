from decimal import Decimal


def test_dashboard_series_and_dues_come_from_records(client, auth):
    d = client.get("/api/v1/dashboard", headers=auth).json()
    weeks = d["weekly_sales"]
    assert len(weeks) == 4
    assert [w["week_start"] for w in weeks] == sorted(w["week_start"] for w in weeks)
    assert weeks[-1]["revenue"] == d["last_week_sales"] == "9130.00"
    dues = d["dues"]
    assert Decimal(dues["pending"]) + Decimal(dues["overdue"]) == Decimal(d["outstanding_dues"]) == Decimal("1850.00")
    assert dues["overdue"] == "1200.00" and dues["paid"] == "900.00"
