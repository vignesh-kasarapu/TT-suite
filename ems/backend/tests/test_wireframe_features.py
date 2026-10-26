"""Features added from the wireframes: withdraw, comments, profile/bank, policy periods, lists, admin tools."""
from datetime import timedelta

from app.core.time import today


def test_withdraw_returns_claim_to_edit_and_resubmit(as_user):
    eshan, maya = as_user("eshan"), as_user("maya")
    claim = eshan.submit([eshan.line("Office supplies & equipment", 500)])
    assert claim["can_withdraw"]
    back = eshan.ok("post", f"/api/claims/{claim['id']}/withdraw")
    assert back["status"] == "WITHDRAWN" and back["can_edit"] and not maya.step_for(claim["id"])
    assert maya.post(f"/api/claims/{claim['id']}/withdraw").status_code == 404  # only the owner
    again = eshan.ok("put", f"/api/claims/{claim['id']}", {"title": "Again", "lines": back["lines"]})
    assert again["status"] == "PENDING_APPROVAL"


def test_comments_notify_the_other_side(as_user):
    eshan, maya = as_user("eshan"), as_user("maya")
    claim = eshan.submit([eshan.line("Office supplies & equipment", 500)])
    after = maya.ok("post", f"/api/claims/{claim['id']}/comments", {"body": "Can you add attendee names?"})
    assert after["comments"][0]["author_name"] == "Maya Iyer"
    assert any("commented" in n["message"] for n in eshan.ok("get", "/api/notifications"))
    assert as_user("esha").post(f"/api/claims/{claim['id']}/comments", {"body": "hi"}).status_code == 404


def test_notification_preferences_mute_comments(as_user):
    eshan, maya = as_user("eshan"), as_user("maya")
    eshan.ok("put", "/api/auth/me/notifications", {"prefs": {"COMMENT": False}})
    claim = eshan.submit([eshan.line("Office supplies & equipment", 500)])
    maya.ok("post", f"/api/claims/{claim['id']}/comments", {"body": "Looks fine"})
    assert not any("commented" in n["message"] for n in eshan.ok("get", "/api/notifications"))


def test_late_submission_blocked(as_user):
    eshan = as_user("eshan")
    old = (today() - timedelta(days=120)).isoformat()
    r = eshan.post("/api/claims", {"title": "old", "lines": [eshan.line("Office supplies & equipment", 300, expense_date=old)]})
    assert r.status_code == 400 and "older than 90 days" in str(r.json()["errors"])


def test_receipt_only_needed_above_threshold(as_user):
    eshan = as_user("eshan")
    small = eshan.line("Local transport", 150, receipt_path=None, receipt_name=None)
    assert eshan.submit([small])["status"] == "PENDING_APPROVAL"
    big = eshan.line("Local transport", 450, receipt_path=None, receipt_name=None)
    assert eshan.post("/api/claims", {"title": "big", "lines": [big]}).status_code == 400


def test_required_project_and_list_checked(as_user):
    admin, eshan = as_user("admin"), as_user("eshan")
    admin.ok("put", "/api/admin/settings", {"require_project": True})
    r = eshan.post("/api/claims", {"title": "x", "lines": [eshan.line("Office supplies & equipment", 300)]})
    assert "project" in str(r.json()["errors"]).lower()
    r = eshan.post("/api/claims", {"title": "x", "project": "Nope", "lines": [eshan.line("Office supplies & equipment", 300)]})
    assert r.status_code == 400  # not in the Admin's project list
    assert eshan.ok("post", "/api/claims", {"title": "y", "project": "Project Alpha", "lines": [eshan.line("Office supplies & equipment", 300)]})["project"] == "Project Alpha"


def test_day_limit(as_user):
    admin, eshan = as_user("admin"), as_user("eshan")
    cat = eshan.category("Office supplies & equipment")
    admin.ok("post", "/api/admin/limits", {"category_id": cat, "scope": "COMPANY", "period": "DAY", "amount": 1000,
                                           "action": "BLOCK", "effective_from": "2026-01-01"})
    r = eshan.post("/api/claims", {"title": "x", "lines": [eshan.line("Office supplies & equipment", 600), eshan.line("Office supplies & equipment", 600)]})
    assert r.status_code == 400 and "per day" in str(r.json()["errors"])


def test_fallback_approver_when_no_manager(as_user):
    admin, vikram, arun = as_user("admin"), as_user("vikram"), as_user("arun")
    admin.ok("put", "/api/admin/settings", {"fallback_approver_id": arun.user["id"]})
    admin.ok("put", "/api/admin/settings", {"self_approval_cap": 1})  # stop Vikram (a Manager) self-approving
    claim = vikram.submit([vikram.line("Client meals", 3000)])
    assert arun.step_for(claim["id"])  # Vikram has no manager
    assert admin.client.put("/api/admin/settings", json={"fallback_approver_id": admin.user["id"]}).status_code == 400  # Admin never approves


def test_bank_change_needs_finance_verification(as_user):
    eshan, fiona = as_user("eshan"), as_user("fiona")
    assert eshan.client.put("/api/auth/me/bank", json={"account_holder": "Eshan", "account_no": "12", "ifsc": "x"}).status_code == 400
    me = eshan.ok("put", "/api/auth/me/bank", {"account_holder": "Eshan Gupta", "account_no": "123456789", "ifsc": "HDFC0001234"})
    assert me["bank_change_pending"] and me["bank_account_no_masked"] == ""
    pending = fiona.ok("get", "/api/finance/bank-changes")
    assert pending[0]["requested"]["bank_ifsc"] == "HDFC0001234"
    fiona.ok("post", f"/api/finance/bank-changes/{eshan.user['id']}/verify")
    me = eshan.ok("get", "/api/auth/me")
    assert me["bank_account_no_masked"] == "•••• 6789" and not me["bank_change_pending"]


def test_sign_out_everywhere(as_user):
    eshan = as_user("eshan")
    eshan.ok("post", "/api/auth/me/sign-out-everywhere")
    assert eshan.get("/api/auth/me").status_code == 401
    assert as_user("eshan").get("/api/auth/me").status_code == 200  # a fresh sign-in works


def test_bulk_return_and_search(as_user):
    eshan, maya = as_user("eshan"), as_user("maya")
    c1 = eshan.submit([eshan.line("Office supplies & equipment", 100)], title="Pens for team")
    c2 = eshan.submit([eshan.line("Office supplies & equipment", 200)], title="Printer paper")
    out = maya.ok("post", "/api/approvals/bulk-send-back", {"claim_ids": [c1["id"], c2["id"]], "reason": "Add project"})
    assert len(out["returned"]) == 2
    found = eshan.ok("get", "/api/claims?scope=mine&q=printer")
    assert [c["id"] for c in found] == [c2["id"]] and found[0]["line_count"] == 1


def test_inbox_shows_next_step(as_user):
    eshan, maya = as_user("eshan"), as_user("maya")
    claim = eshan.submit([eshan.line("Flights & trains", 60000), eshan.line("Flights & trains", 1000)])
    nxt = sorted(i["next_step"] for i in maya.step_for(claim["id"]))
    assert nxt == ["Finance", "Level 2"]


def test_policy_page_and_lists(as_user):
    eshan = as_user("eshan")
    policy = eshan.ok("get", "/api/policy")
    meals = next(c for c in policy["categories"] if c["name"] == "Client meals")
    assert meals["group"] == "Food" and meals["limits"][0]["over_limit"] == "Allow with reason"
    assert "Project Alpha" in eshan.ok("get", "/api/lookups/lists")["projects"]


def test_admin_csv_import(as_user):
    admin = as_user("admin")
    csv = ("email,full_name,employee_code,department,location,manager_email,roles,phone,designation\n"
           "new@example.com,New Person,E100,Engineering,Pune,maya@example.com,,999,Engineer\n"
           "bad@example.com,Bad,E101,,,,APPROVER;FINANCE,,\n"
           "odd@example.com,Odd,E102,,,fiona@example.com,,,\n")
    r = admin.client.post("/api/admin/users/import", files={"file": ("u.csv", csv.encode(), "text/csv")})
    errors = r.json()["errors"]
    assert r.status_code == 200 and r.json()["created"] == 2
    assert "Manager and a Finance Reviewer" in errors[0] and "does not hold the Manager role" in errors[1]
    new = next(u for u in admin.ok("get", "/api/admin/users") if u["email"] == "new@example.com")
    assert new["designation"] == "Engineer" and new["manager_id"] == as_user("maya").user["id"]
    assert admin.ok("get", "/api/admin/last-change")["what"] == "users imported"
