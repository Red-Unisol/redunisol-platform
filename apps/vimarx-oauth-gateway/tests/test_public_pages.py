import pytest
from test_gateway import bridge, send


@pytest.mark.parametrize("page", ["/", "/support", "/privacy", "/terms"])
def test_listing_pages_are_public_prefix_safe_and_do_not_call_vimarx(bridge, page):
    _, client, upstream = bridge
    response = send(client, "GET", "/vimarx-oauth" + page)
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'lang="es"' in html and "Celesol" in html
    assert 'href="https://gateway.example/vimarx-oauth/privacy"' in html
    assert 'href="https://gateway.example/vimarx-oauth/support"' in html
    assert upstream.calls == []
    # Public listing pages must not turn the protected MCP into anonymous access.
    assert send(client, "POST", "/vimarx-oauth/mcp", json={}).status_code == 401


def test_privacy_explains_optional_password_storage_expiry_and_backup_deletion(bridge):
    _, client, _ = bridge
    html = send(client, "GET", "/vimarx-oauth/privacy").get_data(as_text=True)
    for phrase in ("Mantener conectado", "30 días", "siete días", "no se conserva", "info@redunisol.com.ar"):
        assert phrase in html
    assert '/vimarx-oauth/connections' in html
