import json
import os
import re
import secrets
import time
from datetime import timedelta
from urllib.parse import urlsplit

from authlib.integrations.flask_oauth2 import AuthorizationServer
from authlib.oauth2 import OAuth2Error
from authlib.oauth2.rfc6749 import grants
from authlib.oauth2.rfc6749.errors import InvalidGrantError
from authlib.oauth2.rfc7636 import CodeChallenge
from cryptography.fernet import Fernet
from flask import Flask, jsonify, redirect, render_template, request, session
from sqlalchemy import delete, update
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import generate_password_hash

from .models import Client, Code, RateBucket, Token, UserSession, db, digest
from .upstream import UpstreamError, Vimarx

READ_TOOLS = frozenset({
    "get_version", "contexto_cliente", "get_entidades", "get_propiedades",
    "get_lineas_prestamo", "get_fecha_trabajo", "get_prestamos",
    "get_cuotas_prestamo", "get_amt_socio", "get_cuentas_amv", "get_movimientos",
    "get_socio_por_numero", "get_socio_por_dni", "get_socio_por_cuit",
    "get_domicilio", "get_tasas_amt",
})
PROTOCOLS = {"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"}
SCOPE = "mcp:read"


def create_app(config=None, upstream=None):
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("GATEWAY_SECRET_KEY"),
        TOKEN_ENCRYPTION_KEY=os.environ.get("TOKEN_ENCRYPTION_KEY"),
        ISSUER=os.environ.get("GATEWAY_ISSUER", "https://kestra.redunisol.com.ar/vimarx-oauth"),
        VIMARX_ORIGIN=os.environ.get("VIMARX_ORIGIN", "https://celesol.dyndns.org:35010"),
        SQLALCHEMY_DATABASE_URI=os.environ.get("DATABASE_URL", "sqlite:////data/gateway.db"),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SQLALCHEMY_ENGINE_OPTIONS={"connect_args": {"timeout": 20}},
        SESSION_COOKIE_NAME="__Secure-vimarx-oauth",
        SESSION_COOKIE_SECURE=True,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=timedelta(minutes=10),
        MAX_CONTENT_LENGTH=1024 * 1024,
        OAUTH2_SCOPES_SUPPORTED=[SCOPE],
        OAUTH2_REFRESH_TOKEN_GENERATOR=False,
        OAUTH2_TOKEN_EXPIRES_IN={"authorization_code": 1800},
        GIT_SHA=os.environ.get("GIT_SHA", "development"),
        EXTRA_REDIRECT_URIS=[],
    )
    if config:
        app.config.update(config)
    if not app.config["SECRET_KEY"] or len(app.config["SECRET_KEY"]) < 32:
        raise ValueError("GATEWAY_SECRET_KEY must contain at least 32 characters")
    cipher = Fernet(app.config["TOKEN_ENCRYPTION_KEY"])
    issuer = app.config["ISSUER"].rstrip("/")
    parsed = urlsplit(issuer)
    if parsed.scheme != "https" or parsed.query or parsed.fragment or parsed.username:
        raise ValueError("GATEWAY_ISSUER must be a canonical HTTPS URL")
    origin = urlsplit(app.config["VIMARX_ORIGIN"])
    if origin.scheme != "https" or origin.path not in ("", "/") or origin.query or origin.username:
        raise ValueError("VIMARX_ORIGIN must be a fixed HTTPS origin")
    prefix = parsed.path.rstrip("/")
    resource = issuer + "/mcp"
    app.config["SESSION_COOKIE_PATH"] = prefix or "/"
    # Only one proxy hop: the loopback-only container is reached through Apache.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
    db.init_app(app)
    with app.app_context():
        db.create_all()
    vimarx = upstream or Vimarx(app.config["VIMARX_ORIGIN"])

    def query_client(client_id):
        return db.session.execute(db.select(Client).filter_by(client_id=client_id)).scalar_one_or_none()

    def save_token(token_data, oauth_request):
        user = oauth_request.user
        if not user or not user.is_active():
            raise InvalidGrantError("Vimarx session expired; sign in again.")
        code = oauth_request.authorization_code
        claimed = db.session.execute(
            update(Code).where(Code.id == code.id, Code.consumed.is_(False)).values(consumed=True)
        )
        if claimed.rowcount != 1:
            db.session.rollback()
            raise InvalidGrantError("Authorization code already redeemed.")
        ttl = min(int(token_data["expires_in"]), user.expires_at - int(time.time()) - 15)
        token_data["expires_in"] = ttl
        db.session.add(Token(
            client_id=oauth_request.client.client_id,
            user_id=user.id,
            resource=resource,
            access_token=digest(token_data["access_token"]),
            token_type="Bearer",
            scope=SCOPE,
            issued_at=int(time.time()),
            expires_in=ttl,
        ))
        db.session.commit()

    server = AuthorizationServer(app, query_client=query_client, save_token=save_token)

    class AuthorizationCodeGrant(grants.AuthorizationCodeGrant):
        TOKEN_ENDPOINT_AUTH_METHODS = ["none", "client_secret_basic", "client_secret_post"]

        def save_authorization_code(self, code, oauth_request):
            data = oauth_request.payload.data
            db.session.add(Code(
                code=digest(code), client_id=oauth_request.client.client_id,
                redirect_uri=oauth_request.payload.redirect_uri,
                scope=SCOPE, user_id=oauth_request.user.id, resource=resource,
                code_challenge=data["code_challenge"], code_challenge_method="S256",
            ))
            db.session.commit()

        def query_authorization_code(self, code, client):
            item = db.session.execute(db.select(Code).filter_by(
                code=digest(code), client_id=client.client_id, consumed=False
            )).scalar_one_or_none()
            if item and not item.is_expired() and item.resource == resource:
                return item

        def delete_authorization_code(self, authorization_code):
            db.session.delete(authorization_code)
            db.session.commit()

        def authenticate_user(self, authorization_code):
            user = db.session.get(UserSession, authorization_code.user_id)
            return user if user and user.is_active() else None

    class S256Challenge(CodeChallenge):
        SUPPORTED_CODE_CHALLENGE_METHOD = ["S256"]

    server.register_grant(AuthorizationCodeGrant, [S256Challenge(required=True)])

    next_cleanup = [0.0]

    def purge_expired():
        now = int(time.time())
        db.session.execute(delete(Code).where(Code.auth_time < now - 300))
        db.session.execute(delete(Token).where(Token.issued_at + Token.expires_in < now))
        db.session.execute(delete(UserSession).where(UserSession.expires_at < now))
        db.session.execute(delete(RateBucket).where(RateBucket.window < now // 60 - 1440))
        db.session.commit()

    def rate_limit(category, limit, seconds=60):
        now = int(time.time())
        key = digest(category + ":" + (request.remote_addr or "unknown"))
        # Atomic SQLite upsert prevents concurrent requests bypassing the limit.
        from sqlalchemy.dialects.sqlite import insert
        bucket = now // seconds
        statement = insert(RateBucket).values(key=key, window=bucket, attempts=1)
        statement = statement.on_conflict_do_update(
            index_elements=[RateBucket.key],
            set_={"window": bucket, "attempts": db.case(
                (RateBucket.window == bucket, RateBucket.attempts + 1), else_=1
            )},
        ).returning(RateBucket.attempts)
        attempts = db.session.execute(statement).scalar_one()
        db.session.commit()
        return attempts > limit

    @app.before_request
    def canonical_host():
        if request.host != parsed.netloc:
            return jsonify(error="invalid_host"), 400
        if time.monotonic() >= next_cleanup[0]:
            purge_expired()
            next_cleanup[0] = time.monotonic() + 300

    @app.after_request
    def security_headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; style-src 'self'; form-action 'self'; "
            "frame-ancestors 'none'; base-uri 'none'"
        )
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.get(prefix + "/health")
    def health():
        return jsonify(status="ok", revision=app.config["GIT_SHA"])

    @app.get(prefix + "/")
    def home():
        return render_template("home.html", resource=resource)

    @app.get(prefix + "/style.css")
    def style():
        return app.send_static_file("style.css")

    @app.get("/.well-known/oauth-authorization-server" + prefix)
    @app.get(prefix + "/.well-known/oauth-authorization-server")
    def authorization_metadata():
        return jsonify(
            issuer=issuer, authorization_endpoint=issuer + "/authorize",
            token_endpoint=issuer + "/token", registration_endpoint=issuer + "/register",
            revocation_endpoint=issuer + "/revoke", scopes_supported=[SCOPE],
            response_types_supported=["code"], grant_types_supported=["authorization_code"],
            token_endpoint_auth_methods_supported=["none", "client_secret_basic", "client_secret_post"],
            code_challenge_methods_supported=["S256"],
            authorization_response_iss_parameter_supported=True,
        )

    @app.get("/.well-known/oauth-protected-resource" + prefix + "/mcp")
    @app.get(prefix + "/.well-known/oauth-protected-resource")
    def resource_metadata():
        return jsonify(resource=resource, authorization_servers=[issuer],
                       scopes_supported=[SCOPE], bearer_methods_supported=["header"])

    def allowed_redirect(uri):
        if uri in app.config["EXTRA_REDIRECT_URIS"]:
            return True
        try:
            p = urlsplit(uri)
        except ValueError:
            return False
        return (p.scheme == "https" and p.netloc == "chatgpt.com"
                and not p.query and not p.fragment and (
                    p.path == "/connector_platform_oauth_redirect"
                    or re.fullmatch(r"/connector/oauth/[A-Za-z0-9_-]{1,128}", p.path)
                ))

    @app.post(prefix + "/register")
    def register():
        if rate_limit("registration", 15):
            return jsonify(error="rate_limit_exceeded"), 429
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify(error="invalid_client_metadata"), 400
        uris = body.get("redirect_uris")
        if (not isinstance(uris, list) or not 1 <= len(uris) <= 5
                or any(not isinstance(u, str) or not allowed_redirect(u) for u in uris)):
            return jsonify(error="invalid_redirect_uri"), 400
        method = body.get("token_endpoint_auth_method", "client_secret_basic")
        if method not in {"none", "client_secret_basic", "client_secret_post"}:
            return jsonify(error="invalid_client_metadata"), 400
        if body.get("grant_types", ["authorization_code"]) != ["authorization_code"]:
            return jsonify(error="invalid_client_metadata"), 400
        if body.get("response_types", ["code"]) != ["code"]:
            return jsonify(error="invalid_client_metadata"), 400
        if body.get("scope", SCOPE) != SCOPE:
            return jsonify(error="invalid_client_metadata"), 400
        secret = secrets.token_urlsafe(32) if method != "none" else ""
        client = Client(client_id=secrets.token_urlsafe(24), client_id_issued_at=int(time.time()),
                        client_secret=generate_password_hash(secret) if secret else "")
        metadata = dict(client_name="ChatGPT · Vimarx Celesol", redirect_uris=uris,
                        token_endpoint_auth_method=method, grant_types=["authorization_code"],
                        response_types=["code"], scope=SCOPE)
        client.set_client_metadata(metadata)
        db.session.add(client)
        db.session.commit()
        result = dict(metadata, client_id=client.client_id, client_id_issued_at=client.client_id_issued_at)
        if secret:
            result.update(client_secret=secret, client_secret_expires_at=0)
        return jsonify(result), 201

    def valid_resource(values):
        return values.getlist("resource") == [resource]

    def issuer_response(response):
        if response.status_code == 302:
            from urllib.parse import urlencode
            location = response.headers["Location"]
            response.headers["Location"] = location + ("&" if "?" in location else "?") + urlencode({"iss": issuer})
        return response

    @app.route(prefix + "/authorize", methods=["GET", "POST"])
    def authorize():
        if not valid_resource(request.args):
            return jsonify(error="invalid_target"), 400
        if (request.args.get("code_challenge_method") != "S256"
                or not re.fullmatch(r"[A-Za-z0-9_-]{43}", request.args.get("code_challenge", ""))):
            return jsonify(error="invalid_request", error_description="Se requiere PKCE S256."), 400
        # Only query parameters define the authorization transaction. The signed
        # cookie binds the exact query to the login/consent form (no form overrides).
        if request.method == "POST":
            csrf = request.form.get("csrf", "")
            expected = session.pop("csrf", "")
            bound = session.pop("transaction", "")
            if (not expected or not secrets.compare_digest(csrf, expected)
                    or bound != digest(request.query_string.decode())):
                return jsonify(error="invalid_request", error_description="Formulario vencido."), 400
            if set(request.form) - {"csrf", "username", "password", "approve"}:
                return jsonify(error="invalid_request"), 400
        try:
            grant = server.get_consent_grant()
        except OAuth2Error as error:
            return jsonify(error=error.error, error_description=error.description), 400
        error_message = None
        if request.method == "POST":
            if request.form.get("approve") != "yes":
                return issuer_response(server.create_authorization_response(grant=grant, grant_user=None))
            if rate_limit("login", 8):
                return jsonify(error="rate_limit_exceeded"), 429
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            if not username or len(username) > 128 or not password or len(password) > 512:
                error_message = "Ingresá tu usuario y contraseña de Vimarx."
            else:
                try:
                    token, expiry = vimarx.login(username, password)
                    user = UserSession(id=secrets.token_urlsafe(24), expires_at=expiry,
                                       upstream_token=cipher.encrypt(token.encode()).decode())
                    db.session.add(user)
                    db.session.commit()
                    response = issuer_response(server.create_authorization_response(grant=grant, grant_user=user))
                    session.clear()
                    return response
                except UpstreamError as error:
                    error_message = str(error)
        session["csrf"] = secrets.token_urlsafe(32)
        session["transaction"] = digest(request.query_string.decode())
        session.permanent = True
        return render_template("authorize.html", csrf=session["csrf"], error=error_message,
                               resource=resource, client_name=grant.client.client_name), (401 if error_message else 200)

    @app.post(prefix + "/token")
    def issue_token():
        if rate_limit("token", 60):
            return jsonify(error="rate_limit_exceeded"), 429
        if not valid_resource(request.form):
            return jsonify(error="invalid_target"), 400
        return server.create_token_response()

    def bearer():
        parts = request.headers.get("Authorization", "").split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return None
        item = db.session.execute(db.select(Token).filter_by(access_token=digest(parts[1]))).scalar_one_or_none()
        if (not item or item.is_expired() or item.is_revoked()
                or item.resource != resource or item.scope != SCOPE):
            return None
        user = db.session.get(UserSession, item.user_id)
        return user if user and user.is_active() else None

    def challenge():
        metadata = f"{parsed.scheme}://{parsed.netloc}/.well-known/oauth-protected-resource{prefix}/mcp"
        response = jsonify(error="invalid_token")
        response.status_code = 401
        response.headers["WWW-Authenticate"] = f'Bearer resource_metadata="{metadata}", scope="{SCOPE}"'
        return response

    @app.post(prefix + "/revoke")
    def revoke():
        # Possession is required, matching RFC7009's public-client token revocation.
        if rate_limit("revoke", 60):
            return jsonify(error="rate_limit_exceeded"), 429
        raw = request.form.get("token", "")
        db.session.execute(update(Token).where(Token.access_token == digest(raw)).values(
            access_token_revoked_at=int(time.time())))
        db.session.commit()
        return "", 200

    def rpc_error(message_id, code, message):
        return jsonify(jsonrpc="2.0", id=message_id, error={"code": code, "message": message})

    @app.route(prefix + "/mcp", methods=["GET", "POST", "DELETE"])
    def mcp():
        user = bearer()
        if not user:
            return challenge()
        # Stateless Streamable HTTP; no GET subscription/session to expose tools
        # outside the POST allowlist, and no sessions to delete.
        if request.method != "POST":
            return "", 405, {"Allow": "POST"}
        if rate_limit("mcp", 180):
            return jsonify(error="rate_limit_exceeded"), 429
        message = request.get_json(silent=True)
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
            return rpc_error(None, -32600, "Solicitud JSON-RPC inválida.")
        message_id = message.get("id")
        if "id" in message and (isinstance(message_id, (dict, list, bool)) or message_id is None):
            return rpc_error(None, -32600, "Identificador inválido.")
        method = message.get("method")
        params = message.get("params", {})
        if not isinstance(method, str):
            return rpc_error(message_id, -32600, "Método inválido.")
        if not isinstance(params, dict):
            return rpc_error(message_id, -32602, "Parámetros inválidos.")
        if method in {"notifications/initialized", "notifications/cancelled"} and "id" not in message:
            return "", 202
        if method == "ping":
            return jsonify(jsonrpc="2.0", id=message_id, result={})
        if method not in {"initialize", "tools/list", "tools/call"}:
            return rpc_error(message_id, -32601, "Método no permitido por el puente de solo lectura.")
        if "id" not in message:
            return rpc_error(None, -32600, "La operación requiere un identificador.")
        if method == "tools/call" and (
            not isinstance(params.get("name"), str) or params.get("name") not in READ_TOOLS
            or not isinstance(params.get("arguments", {}), dict)
        ):
            return rpc_error(message_id, -32601, "Herramienta no permitida por el puente de solo lectura.")
        protocol = request.headers.get("MCP-Protocol-Version", "2025-06-18")
        if method == "initialize":
            protocol = params.get("protocolVersion", protocol)
        if not isinstance(protocol, str) or protocol not in PROTOCOLS:
            return rpc_error(message_id, -32602, "Versión de protocolo no soportada.")
        # Rebuild the envelope; never forward headers, client tokens, batch calls,
        # or arbitrary top-level extension fields to the upstream.
        forwarded = dict(jsonrpc="2.0", id=message_id, method=method, params=params)
        try:
            result = vimarx.rpc(cipher.decrypt(user.upstream_token.encode()).decode(), forwarded, protocol)
        except UpstreamError:
            return rpc_error(message_id, -32000, "No se pudo completar la consulta en Vimarx. Volvé a conectar si la sesión venció.")
        if not isinstance(result, dict):
            return rpc_error(message_id, -32603, "Respuesta inesperada de Vimarx.")
        if method == "initialize" and isinstance(result.get("result"), dict):
            init = result["result"]
            init["capabilities"] = {"tools": {"listChanged": False}}
            init["serverInfo"] = {"name": "redunisol-vimarx-readonly", "version": "1.0.0"}
            init["instructions"] = "Consultas de solo lectura de Celesol con los permisos del usuario conectado."
        if method == "tools/list" and isinstance(result.get("result"), dict):
            tools = []
            for tool in result["result"].get("tools", []):
                if tool.get("name") in READ_TOOLS:
                    tool["annotations"] = dict(readOnlyHint=True, destructiveHint=False,
                                               idempotentHint=True, openWorldHint=False)
                    tools.append(tool)
            result["result"]["tools"] = tools
        return jsonify(result)

    @app.cli.command("cleanup")
    def cleanup():
        """Remove expired credentials and abandoned authorization transactions."""
        purge_expired()

    return app
