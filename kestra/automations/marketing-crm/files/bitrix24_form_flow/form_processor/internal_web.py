"""HTTPS origins shared by the internal CRM receipt APIs."""
from urllib.request import HTTPRedirectHandler, build_opener


def internal_web_origin(scope):
    return {"redunisol.prod.marketing-crm": "https://redunisol.com.ar",
            "redunisol.dev.marketing-crm": "https://dev.redunisol.com.ar"}.get(scope)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def open_without_redirects(request, *, timeout):
    return build_opener(_NoRedirect()).open(request, timeout=timeout)
