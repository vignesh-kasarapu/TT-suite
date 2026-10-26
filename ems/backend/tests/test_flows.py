"""End-to-end flows against the seeded FRD-2.3 rules.

Seed: eshan/esha report to maya; maya, tara, arun, hema, finance and admin report to vikram.
Level 1 is always the reporting manager. Client meals FLAG > 5,000. Any line above 20,000 also goes to vikram (Level 2).
Only Managers (APPROVER) and Admins may self-approve and request advances. Admins never approve.
"""
from sqlalchemy import text

from app.core.db import engine


def test_partial_approval_below_range_skips_level2(as_user):
    eshan, maya, fiona = as_user("eshan"), as_user("maya"), as_user("fiona")
    claim = eshan.submit([eshan.line("Flights & trains", 25000), eshan.line("Office supplies & equipment", 1500)])
    assert claim["status"] == "PENDING_APPROVAL"

    travel_step, office_step = sorted(maya.step_for(claim["id"]), key=lambda s: s["line_id"])  # both to the manager
    maya.ok("post", f"/api/approvals/steps/{travel_step['step_id']}/approve", {"amount": 15000})
    after = maya.ok("post", f"/api/approvals/steps/{office_step['step_id']}/approve", {})

    assert after["status"] == "PENDING_FINANCE"  # FR-2.5: 15,000 approved is not above 20,000
    assert after["total_approved"] == 16500
    assert not [s for s in after["steps"] if s["level"] == "L2"]

    done = fiona.ok("post", f"/api/approvals/claims/{claim['id']}/finance-approve", {})
    assert done["status"] == "READY_FOR_PAYROLL" and done["payout_amount"] == 16500


def test_level2_in_range_and_cannot_raise_amount(as_user):
    eshan, maya, vikram = as_user("eshan"), as_user("maya"), as_user("vikram")
    claim = eshan.submit([eshan.line("Flights & trains", 80000)])
    step = maya.step_for(claim["id"])[0]
    r = maya.post(f"/api/approvals/steps/{step['step_id']}/approve", {"amount": 90000})
    assert r.status_code == 400  # A14: can only lower
    maya.ok("post", f"/api/approvals/steps/{step['step_id']}/approve", {})
    l2 = vikram.step_for(claim["id"])
    assert l2 and l2[0]["level"] == "L2"
    after = vikram.ok("post", f"/api/approvals/steps/{l2[0]['step_id']}/approve", {})
    assert after["status"] == "PENDING_FINANCE"


def test_reject_one_line_others_continue(as_user):
    eshan, maya = as_user("eshan"), as_user("maya")
    claim = eshan.submit([eshan.line("Office supplies & equipment", 500), eshan.line("Office supplies & equipment", 700)])
    s1, s2 = sorted(maya.step_for(claim["id"]), key=lambda s: s["line_id"])
    r = maya.post(f"/api/approvals/steps/{s1['step_id']}/reject", {"reason": ""})
    assert r.status_code == 400  # reason needed
    maya.ok("post", f"/api/approvals/steps/{s1['step_id']}/reject", {"reason": "Personal item"})
    after = maya.ok("post", f"/api/approvals/steps/{s2['step_id']}/approve", {})
    assert after["status"] == "PENDING_FINANCE" and after["total_approved"] == 700
    assert after["lines"][0]["status"] == "REJECTED" and after["lines"][0]["reject_reason"] == "Personal item"


def test_all_lines_rejected_rejects_claim(as_user):
    eshan, maya = as_user("eshan"), as_user("maya")
    claim = eshan.submit([eshan.line("Office supplies & equipment", 500)])
    step = maya.step_for(claim["id"])[0]
    after = maya.ok("post", f"/api/approvals/steps/{step['step_id']}/reject", {"reason": "No"})
    assert after["status"] == "REJECTED"


def test_send_back_restarts_from_level1(as_user):
    eshan, maya, vikram = as_user("eshan"), as_user("maya"), as_user("vikram")
    claim = eshan.submit([eshan.line("Flights & trains", 70000)])
    maya.ok("post", f"/api/approvals/steps/{maya.step_for(claim['id'])[0]['step_id']}/approve", {})
    back = vikram.ok("post", f"/api/approvals/claims/{claim['id']}/send-back", {"reason": "Attach boarding pass"})
    assert back["status"] == "SENT_BACK"
    again = eshan.ok("put", f"/api/claims/{claim['id']}", {"title": "Trip", "lines": [{**l, "id": l["id"]} for l in back["lines"]]})
    assert again["status"] == "PENDING_APPROVAL" and again["round"] == 2
    assert maya.step_for(claim["id"])[0]["level"] == "L1"


def test_delegation_full_handover(as_user):
    maya, arun, esha = as_user("maya"), as_user("arun"), as_user("esha")
    claim = esha.submit([esha.line("Office supplies & equipment", 900)])
    assert maya.step_for(claim["id"])
    r = maya.post("/api/delegations", {"delegate_id": as_user("eshan").user["id"], "start_date": "2026-10-01", "end_date": "2026-12-31"})
    assert r.status_code == 400  # A22: delegate must be an Approver
    d = maya.ok("post", "/api/delegations", {"delegate_id": arun.user["id"], "start_date": "2026-10-01", "end_date": "2026-12-31"})

    assert not maya.step_for(claim["id"])  # A23: manager hands over completely
    item = arun.step_for(claim["id"])[0]
    assert item["on_behalf_of"] == "Maya Iyer"
    after = arun.ok("post", f"/api/approvals/steps/{item['step_id']}/approve", {})
    step = next(s for s in after["steps"] if s["level"] == "L1")
    assert step["acted_by_name"] == "Arun Das" and step["on_behalf_of_name"] == "Maya Iyer"

    maya.ok("post", f"/api/delegations/{d['id']}/cancel")
    claim2 = esha.submit([esha.line("Office supplies & equipment", 400)])
    assert maya.step_for(claim2["id"]) and not arun.step_for(claim2["id"])


def test_delegate_never_approves_own_claim(as_user):
    vikram, maya = as_user("vikram"), as_user("maya")
    vikram.ok("post", "/api/delegations", {"delegate_id": maya.user["id"], "start_date": "2026-10-01", "end_date": "2026-12-31"})
    # Maya's flagged meal cancels self-approval; L1 and L2 are both Vikram -> one step at L2, handed to Maya,
    # who is the submitter -> it goes to Maya's manager (Vikram) instead (A25).
    claim = maya.submit([maya.line("Client meals", 25000, justification="Client dinner")])
    assert not maya.step_for(claim["id"])
    assert vikram.step_for(claim["id"])


def test_self_approval_skips_only_own_step(as_user):
    maya, fiona = as_user("maya"), as_user("fiona")
    claim = maya.submit([maya.line("Office supplies & equipment", 2000)])
    assert claim["self_approved"] and claim["status"] == "PENDING_FINANCE"
    assert fiona.step_for(claim["id"])  # FR-3.8: Finance always checks


def test_flag_cancels_self_approval_and_same_l1_l2_acts_once(as_user):
    maya, vikram = as_user("maya"), as_user("vikram")
    r = maya.post("/api/claims", {"title": "x", "lines": [maya.line("Client meals", 25000)]})
    assert r.status_code == 400 and "reason" in str(r.json()["errors"])  # FLAG needs a reason
    assert not maya.ok("get", "/api/claims")  # a failed submit saves nothing: there are no drafts
    claim = maya.submit([maya.line("Client meals", 25000, justification="Client dinner")])
    assert not claim["self_approved"]
    levels = {s["level"]: s["status"] for s in claim["steps"]}
    assert levels == {"L1": "SKIPPED", "L2": "PENDING"}
    assert vikram.step_for(claim["id"])[0]["level"] == "L2"


def test_finance_reviewer_own_claim_goes_to_backup(as_user):
    fiona, vikram, farhan, feroz = as_user("fiona"), as_user("vikram"), as_user("farhan"), as_user("feroz")
    claim = fiona.submit([fiona.line("Office supplies & equipment", 800)])
    vikram.ok("post", f"/api/approvals/steps/{vikram.step_for(claim['id'])[0]['step_id']}/approve", {})
    assert not feroz.step_for(claim["id"])  # not in the pool
    assert farhan.step_for(claim["id"])  # FR-3.9: Finance Backup Reviewer

    own = farhan.submit([farhan.line("Office supplies & equipment", 300)])
    assert not own["self_approved"]  # Finance Reviewers cannot self-approve
    vikram.ok("post", f"/api/approvals/steps/{vikram.step_for(own['id'])[0]['step_id']}/approve", {})
    assert feroz.step_for(own["id"]) and not farhan.step_for(own["id"])


def test_only_managers_and_admins_self_approve_and_request_advances(as_user):
    body = {"amount": 5000, "purpose": "Trip", "expected_settlement_date": "2026-11-30"}
    for key in ("fiona", "esha"):  # Finance Reviewer, Employee
        user = as_user(key)
        assert not user.user["can_request_advance"]
        assert user.post("/api/claims/advances", body).status_code == 403
        assert not user.submit([user.line("Office supplies & equipment", 400)])["self_approved"]
    for key in ("hema", "admin"):  # Manager, Admin
        user = as_user(key)
        assert user.user["can_request_advance"]
        claim = user.submit([user.line("Office supplies & equipment", 400)])
        assert claim["self_approved"] and claim["status"] == "PENDING_FINANCE"  # Finance still checks


def test_role_rules_on_users(as_user):
    admin, maya, fiona = as_user("admin"), as_user("maya"), as_user("fiona")
    base = {"email": "x@example.com", "full_name": "New Person", "employee_code": "E200"}
    for roles in (["APPROVER", "FINANCE"], ["APPROVER", "ADMIN"]):
        assert admin.post("/api/admin/users", {**base, "roles": roles}).status_code == 400
    r = admin.post("/api/admin/users", {**base, "manager_id": fiona.user["id"]})
    assert r.status_code == 400 and "Manager role" in r.text  # the reporting manager must be a Manager
    admin.ok("post", "/api/admin/users", {**base, "manager_id": maya.user["id"]})


def test_duplicate_invoice_blocked(as_user):
    eshan, esha = as_user("eshan"), as_user("esha")
    gst = {"supplier_gstin": "29ABCDE1234F1Z5", "invoice_no": "INV-77"}
    eshan.submit([eshan.line("Office supplies & equipment", 300, **gst)])
    r = esha.post("/api/claims", {"title": "dup", "lines": [esha.line("Office supplies & equipment", 300, **gst)]})
    assert r.status_code == 400 and "invoice" in str(r.json()["errors"]).lower()


def test_block_policy_limit(as_user):
    eshan = as_user("eshan")
    r = eshan.post("/api/claims", {"title": "big", "lines": [eshan.line("Training & courses", 300000)]})
    assert r.status_code == 400


def test_cash_advance_and_adjustment(as_user):
    eshan, maya, vikram, fiona = as_user("eshan"), as_user("maya"), as_user("vikram"), as_user("fiona")
    body = {"amount": 20000, "purpose": "Client visit", "expected_settlement_date": "2026-11-30"}
    assert eshan.post("/api/claims/advances", body).status_code == 403  # A39: only Managers and Admins
    adv = maya.ok("post", "/api/claims/advances", body)
    assert adv["claim_no"].startswith("ADV-")
    assert maya.post("/api/claims/advances", body).status_code == 400  # A41: one open advance
    assert adv["self_approved"] and adv["status"] == "PENDING_FINANCE"  # A42: same self-approval rules as claims
    adv = fiona.ok("post", f"/api/approvals/claims/{adv['id']}/finance-approve", {})
    assert adv["advance_status"] == "OPEN" and adv["advance_balance"] == 20000

    # Maya self-approves an office claim; Finance approves; it is fully absorbed by the advance (A44)
    claim = maya.submit([maya.line("Office supplies & equipment", 5000)])
    done = fiona.ok("post", f"/api/approvals/claims/{claim['id']}/finance-approve", {})
    assert done["status"] == "PAID" and done["payout_amount"] == 0 and done["advance_deducted"] == 5000
    assert maya.ok("get", f"/api/claims/{adv['id']}")["advance_balance"] == 15000


def test_large_advance_needs_level2(as_user):
    maya, vikram = as_user("maya"), as_user("vikram")
    adv = maya.ok("post", "/api/claims/advances", {"amount": 40000, "purpose": "Offsite", "expected_settlement_date": "2026-11-30"})
    assert adv["status"] == "PENDING_APPROVAL"  # L1 self-approved, 40,000 is above 20,000
    assert vikram.step_for(adv["id"])[0]["level"] == "L2"


def test_payroll_batch_and_results(as_user):
    eshan, maya, fiona = as_user("eshan"), as_user("maya"), as_user("fiona")
    claim = eshan.submit([eshan.line("Office supplies & equipment", 1200)])
    maya.ok("post", f"/api/approvals/steps/{maya.step_for(claim['id'])[0]['step_id']}/approve", {})
    claim = fiona.ok("post", f"/api/approvals/claims/{claim['id']}/finance-approve", {})
    month = claim["payment_month"]
    preview = fiona.ok("get", f"/api/finance/batch-preview?month={month}")
    assert preview["claim_count"] == 1 and preview["total_amount"] == 1200
    assert fiona.post("/api/finance/batches", {"month": month, "expected_count": 5}).status_code == 409
    batch = fiona.ok("post", "/api/finance/batches", {"month": month, "expected_count": 1})
    assert fiona.get(f"/api/finance/batches/{batch['id']}/export").status_code == 200
    fiona.ok("post", f"/api/finance/claims/{claim['id']}/failed", {"reason": "Bank account closed"})
    fiona.ok("post", f"/api/finance/claims/{claim['id']}/retry")
    assert eshan.ok("get", f"/api/claims/{claim['id']}")["status"] == "READY_FOR_PAYROLL"


def test_visibility(as_user):
    eshan, esha, fiona, admin = as_user("eshan"), as_user("esha"), as_user("fiona"), as_user("admin")
    claim = eshan.submit([eshan.line("Office supplies & equipment", 100)])
    assert esha.get(f"/api/claims/{claim['id']}").status_code == 404  # FR-1.6
    assert fiona.get(f"/api/claims/{claim['id']}").status_code == 404  # not yet past approval
    assert admin.get(f"/api/claims/{claim['id']}").status_code == 200
    assert admin.post(f"/api/approvals/claims/{claim['id']}/send-back", {"reason": "x"}).status_code == 403  # Admin never approves


def test_level2_is_one_rule_above_20000(as_user):
    eshan, maya, vikram, admin = as_user("eshan"), as_user("maya"), as_user("vikram"), as_user("admin")
    exactly = eshan.submit([eshan.line("Office supplies & equipment", 20000, justification="Laptop")])
    maya.ok("post", f"/api/approvals/steps/{maya.step_for(exactly['id'])[0]['step_id']}/approve", {})
    assert not vikram.step_for(exactly["id"])  # 20,000 is not above 20,000
    above = eshan.submit([eshan.line("Hotel", 20001, justification="Conference week")])  # any category, not just some
    after = maya.ok("post", f"/api/approvals/steps/{maya.step_for(above['id'])[0]['step_id']}/approve", {})
    assert after["status"] == "PENDING_APPROVAL" and vikram.step_for(above["id"])[0]["level"] == "L2"
    assert vikram.ok("get", "/api/auth/me")["is_level2_approver"] and not maya.ok("get", "/api/auth/me")["is_level2_approver"]
    assert admin.client.put("/api/admin/settings", json={"level2_approver_id": eshan.user["id"]}).status_code == 400  # must be a Manager


def test_audit_log_is_append_only(as_user):
    eshan = as_user("eshan")
    eshan.submit([eshan.line("Office supplies & equipment", 100)])
    with engine.connect() as conn:
        try:
            conn.execute(text("UPDATE expense.audit_log SET action = 'X'"))
            raise AssertionError("update should fail")
        except Exception as e:  # noqa: BLE001
            assert "append-only" in str(e)
