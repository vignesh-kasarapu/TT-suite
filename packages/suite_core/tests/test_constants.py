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


def test_sharepoint_site_accepts_the_web_address_and_the_graph_form():
    from suite_core.integrations.sharepoint import site_path

    want = "tektalissolutions.sharepoint.com:/sites/TTSuite"
    for value in (
        "https://tektalissolutions.sharepoint.com/sites/TTSuite",
        "https://tektalissolutions.sharepoint.com/sites/TTSuite/",
        "https://tektalissolutions.sharepoint.com/sites/TTSuite/Shared%20Documents/Forms/AllItems.aspx",
        '"https://tektalissolutions.sharepoint.com/sites/TTSuite"',
        "tektalissolutions.sharepoint.com:/sites/TTSuite",
    ):
        assert site_path(value) == want, value
    assert site_path("https://contoso.sharepoint.com/teams/HR") == "contoso.sharepoint.com:/teams/HR"
    assert site_path("https://contoso.sharepoint.com/") == "contoso.sharepoint.com"


def test_sharepoint_library_by_name_or_web_address():
    from suite_core.integrations.sharepoint import library_matches

    drive = {"name": "Documents", "webUrl": "https://tektalissolutions.sharepoint.com/sites/TTSuite/Shared%20Documents"}
    other = {"name": "Archive", "webUrl": "https://tektalissolutions.sharepoint.com/sites/TTSuite/Archive"}
    page = "https://tektalissolutions.sharepoint.com/sites/TTSuite/Shared%20Documents/Forms/AllItems.aspx"
    assert library_matches(page, drive) and not library_matches(page, other)
    assert library_matches("https://tektalissolutions.sharepoint.com/sites/TTSuite/Shared Documents", drive)
    assert library_matches("Documents", drive) and library_matches("documents", drive)
    assert not library_matches("Shared Documents", other)
