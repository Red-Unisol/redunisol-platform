"""CRM test titles, available to flows that load only bitrix24_form_flow."""

TEST_MARKER = "E2E"
TEST_TITLE = "[PRUEBA WHATSAPP E2E] "


def test_title(lead, title):
    if lead.get("UF_CRM_WA_TEST") == TEST_MARKER and title and not title.startswith(TEST_TITLE):
        return TEST_TITLE + title
    return title
