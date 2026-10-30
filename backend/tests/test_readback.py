from tests.conftest import idem


def restock(client, auth):
    return client.post("/api/v1/assistant/message", json={"text": "Weekend ke liye ₹5,000 ke andar stock arrange karo"},
                       headers=auth).json()["task"]


def test_readback_uses_stored_plan_numbers(client, auth):
    task = restock(client, auth)
    rb = client.get(f"/api/v1/tasks/{task['id']}/readback?lang=en-IN", headers=auth).json()
    assert "₹4,650" in rb["text"] and "₹5,000" in rb["text"] and rb["voice"] == "OFF" and rb["audio_base64"] is None
    hi = client.get(f"/api/v1/tasks/{task['id']}/readback?lang=hi-IN&audio=true", headers=auth).json()
    assert "Kul ₹4,650" in hi["text"] and hi["audio_base64"] is None  # Sarvam off: text only, no fake audio


def test_readback_after_shortage_reads_only_new_spend(client, auth):
    task = restock(client, auth)
    task = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**auth, **idem()}).json()
    rb = client.get(f"/api/v1/tasks/{task['id']}/readback?lang=en-IN", headers=auth).json()
    assert "₹4,850" in rb["text"] and "Change: Sunflower oil 5 packs now from Metro Wholesale (+₹200)" in rb["text"]


def test_readback_needs_pending_approval(client, auth):
    task = restock(client, auth)
    client.post(f"/api/v1/approvals/{task['pending_approval_id']}/reject", headers=auth)
    assert client.get(f"/api/v1/tasks/{task['id']}/readback", headers=auth).status_code == 409
