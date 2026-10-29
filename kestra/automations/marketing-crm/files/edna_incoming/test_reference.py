"""Public opt-in reference for a real, repeatable WhatsApp intake test."""
from .receiver import TEST_REFERENCE, is_test_entry

TEST_CONTRACT = "website-intake-e2e-v1"
TEST_MARKER = "E2E"
TEST_TITLE = "[PRUEBA WHATSAPP E2E] "


def test_title(lead, title):
    if lead.get("UF_CRM_WA_TEST") == TEST_MARKER and title and not title.startswith(TEST_TITLE):
        return TEST_TITLE + title
    return title
