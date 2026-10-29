"""active_apps(): SUITE_SKIP leaves apps out of a deployment (e.g. resume, to save memory)."""

from suite_core.constants import APPS, active_apps, is_active


def test_every_app_is_active_by_default(monkeypatch):
    monkeypatch.delenv("SUITE_SKIP", raising=False)
    assert active_apps() == APPS


def test_skip_resume(monkeypatch):
    monkeypatch.setenv("SUITE_SKIP", "resume")
    assert "resume" not in active_apps()
    assert active_apps() == ("lms", "expense", "kanban", "ams")
    assert not is_active("resume") and is_active("lms")


def test_skip_is_trimmed_case_insensitive_and_ignores_unknown_names(monkeypatch):
    monkeypatch.setenv("SUITE_SKIP", " Kanban , resume ,nope,")
    assert active_apps() == ("lms", "expense", "ams")
