import json
import logging
import click
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
from cryptography.fernet import Fernet, InvalidToken
from flask import Flask, g, jsonify, redirect, render_template, request, session
from sqlalchemy import delete, update
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import generate_password_hash

from .models import Client, Code, PersistentSession, RateBucket, RefreshResponse, Token, UserSession, db, digest
from .upstream import UpstreamError, UpstreamSessionExpired, Vimarx
from .sessions import ReauthenticationRequired, SessionService

READ_TOOLS = frozenset({
    "get_version", "contexto_cliente", "get_entidades", "get_propiedades",
    "get_lineas_prestamo", "get_fecha_trabajo", "get_prestamos",
    "get_cuotas_prestamo", "get_amt_socio", "get_cuentas_amv", "get_movimientos",
    "get_socio_por_numero", "get_socio_por_dni", "get_socio_por_cuit",
    "get_domicilio", "get_tasas_amt", "query_entidad", "query_socios",
    "buscar_socios", "buscar_socios_por_localidad", "get_estadisticas",
    "get_dias_habiles", "es_fecha_habil", "get_estado_instalacion",
    "get_vistas_modelo", "get_herencia_entidad",
})
PROTOCOLS = {"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"}
SCOPE = "mcp:read"


def create_app(config=None, upstream=None):
    app = Flask(__name__)
    app.logger.setLevel(logging.INFO)
    app.config.update(
        SECRET_KEY=os.environ.get("GATEWAY_SECRET_KEY"),
        TOKEN_ENCRYPTION_KEY=os.environ.get("TOKEN_ENCRYPTION_KEY"),
        ISSUER=os.environ.get("GATEWAY_ISSUER", "https://mcp.redunisol.com.ar"),
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
        OAUTH2_REFRESH_TOKEN_GENERATOR=True,
        OAUTH2_TOKEN_EXPIRES_IN={"authorization_code": 1800, "refresh_token": 1800},
        CONNECTION_IDLE_SECONDS=30 * 86400,
        REFRESH_RETRY_SECONDS=15,
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
        if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite:"):
            with db.engine.connect() as connection:
                connection.exec_driver_sql("PRAGMA journal_mode=WAL")
                connection.exec_driver_sql("PRAGMA busy_timeout=20000")
        db.create_all()
    vimarx = upstream or Vimarx(app.config["VIMARX_ORIGIN"])
    sessions = SessionService(app, cipher, vimarx)
    app.extensions["vimarx_sessions"] = sessions

    class CachedRefresh(Exception):
        def __init__(self, token):
            super().__init__("Refresh already completed")
            self.token = token

    def refresh_cache(old):
        cached = db.session.get(RefreshResponse, old.refresh_token)
        user = db.session.get(UserSession, old.user_id)
        if (cached and cached.expires_at > time.time()
                and cached.client_id == old.client_id and sessions.active(user)):
            try:
                payload = json.loads(cipher.decrypt(cached.ciphertext.encode()))
                token = payload["token"]
                token["expires_in"] -= max(0, int(time.time()) - payload["issued_at"])
                return token if token["expires_in"] > 0 else None
            except (InvalidToken, ValueError):
                return None

    def query_client(client_id):
        return db.session.execute(db.select(Client).filter_by(client_id=client_id)).scalar_one_or_none()

    def save_token(token_data, oauth_request):
        user = oauth_request.user
        if not sessions.active(user):
            raise InvalidGrantError("Reconnect your Vimarx account.")
        now = int(time.time())
        remembered = db.session.get(PersistentSession, user.id)
        code = getattr(oauth_request, "authorization_code", None)
        old = getattr(oauth_request, "refresh_token", None)
        if code is not None:
            claimed = db.session.execute(update(Code).where(
                Code.id == code.id, Code.consumed.is_(False)).values(consumed=True))
        else:
            claimed = db.session.execute(update(Token).where(
                Token.id == old.id, Token.refresh_token_revoked_at == 0).values(
                    refresh_token_revoked_at=now))
        if claimed.rowcount != 1:
            db.session.rollback()
            if old is not None:
                cached = refresh_cache(old)
                if cached:
                    raise CachedRefresh(cached)
            raise InvalidGrantError("Authorization already redeemed.")
        ttl = int(token_data["expires_in"])
        if remembered:
            ttl = min(ttl, remembered.last_used_at + sessions.idle_seconds - now)
            remembered.linked_at = remembered.linked_at or now
        else:
            ttl = min(ttl, user.expires_at - now - 15)
            token_data.pop("refresh_token", None)
        if ttl <= 0:
            db.session.rollback()
            raise InvalidGrantError("Reconnect your Vimarx account.")
        token_data["expires_in"] = ttl
        db.session.add(Token(
            client_id=oauth_request.client.client_id, user_id=user.id, resource=resource,
            access_token=digest(token_data["access_token"]), token_type="Bearer", scope=SCOPE,
            refresh_token=digest(token_data["refresh_token"]) if token_data.get("refresh_token") else None,
            issued_at=now, expires_in=ttl))
        if old is not None:
            db.session.add(RefreshResponse(
                token_hash=old.refresh_token, user_id=user.id, client_id=old.client_id,
                ciphertext=cipher.encrypt(json.dumps({"token": token_data, "issued_at": now}).encode()).decode(),
                expires_at=now + app.config["REFRESH_RETRY_SECONDS"]))
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
            return user if sessions.active(user) else None

    class S256Challenge(CodeChallenge):
        SUPPORTED_CODE_CHALLENGE_METHOD = ["S256"]

    server.register_grant(AuthorizationCodeGrant, [S256Challenge(required=True)])

    class RefreshTokenGrant(grants.RefreshTokenGrant):
        TOKEN_ENDPOINT_AUTH_METHODS = AuthorizationCodeGrant.TOKEN_ENDPOINT_AUTH_METHODS
        INCLUDE_NEW_REFRESH_TOKEN = True

        def authenticate_refresh_token(self, raw):
            item = db.session.execute(db.select(Token).filter_by(
                refresh_token=digest(raw))).scalar_one_or_none()
            if (not item or not item.check_client(self.request.client)
                    or item.resource != resource or item.access_token_revoked_at
                    or item.issued_at + sessions.idle_seconds <= time.time()):
                return None
            remembered = db.session.get(PersistentSession, item.user_id)
            user = db.session.get(UserSession, item.user_id)
            if not remembered or not sessions.active(user):
                if remembered:
                    sessions.revoke(item.user_id)
                return None
            if item.refresh_token_revoked_at and not refresh_cache(item):
                # Reuse beyond the brief retry window revokes the whole family.
                sessions.revoke(item.user_id)
                app.logger.warning("oauth_refresh_reuse_revoked")
                return None
            return item

        def authenticate_user(self, credential):
            user = db.session.get(UserSession, credential.user_id)
            if not sessions.active(user):
                raise InvalidGrantError("Reconnect your Vimarx account.")
            return user

        def create_token_response(self):
            cached = refresh_cache(self.request.refresh_token)
            if cached:
                return 200, cached, self.TOKEN_RESPONSE_HEADER
            try:
                return super().create_token_response()
            except CachedRefresh as completed:
                return 200, completed.token, self.TOKEN_RESPONSE_HEADER

        def revoke_old_credential(self, credential):
            # Rotation and its encrypted retry response were committed atomically.
            pass

    server.register_grant(RefreshTokenGrant)

    next_cleanup = [0.0]

    def purge_expired():
        now = int(time.time())
        remembered = list(db.session.execute(db.select(PersistentSession)).scalars())
        for item in remembered:
            if (item.revoked_at or item.last_used_at + sessions.idle_seconds <= now
                    or (not item.linked_at and item.created_at + 600 <= now)):
                sessions.revoke(item.user_id)
                db.session.delete(item)
        db.session.commit()
        persistent_ids = db.select(PersistentSession.user_id)
        db.session.execute(delete(Code).where(Code.auth_time < now - 300))
        db.session.execute(delete(RefreshResponse).where(RefreshResponse.expires_at <= now))
        db.session.execute(delete(Token).where(
            ((Token.refresh_token.is_(None)) & (Token.issued_at + Token.expires_in <= now))
            | (Token.issued_at + sessions.idle_seconds <= now)
            | (Token.access_token_revoked_at > 0)))
        db.session.execute(delete(UserSession).where(
            UserSession.expires_at < now, UserSession.id.not_in(persistent_ids)))
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
        # Chromium also checks form-action when a POST redirects to the OAuth
        # callback. Add only the URI already validated for this client/request.
        form_action = "'self'"
        if getattr(g, "oauth_redirect_uri", None):
            form_action += " " + g.oauth_redirect_uri
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; style-src 'self'; script-src 'self'; form-action " + form_action + "; "
            "frame-ancestors 'none'; base-uri 'none'"
        )
        response.headers["X-Frame-Options"] = "DENY"
        if response.status_code == 429:
            response.headers["Retry-After"] = "60"
        return response

    @app.get(prefix + "/health")
    def health():
        db.session.execute(db.text("SELECT 1"))
        return jsonify(status="ok", revision=app.config["GIT_SHA"], version="2.0.0")

    @app.get(prefix + "/")
    def home():
        return render_template("home.html", resource=resource)

    @app.get(prefix + "/support")
    def support():
        return render_template("support.html", resource=resource)

    @app.get(prefix + "/privacy")
    def privacy():
        return render_template("privacy.html", resource=resource)

    @app.get(prefix + "/terms")
    def terms():
        return render_template("terms.html", resource=resource)

    @app.get(prefix + "/authorize.js")
    def authorize_script():
        return app.send_static_file("authorize.js")

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
            response_types_supported=["code"], grant_types_supported=["authorization_code", "refresh_token"],
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
            port = p.port
        except ValueError:
            return False
        if (p.query or p.fragment or p.username is not None or p.password is not None
                or any(ord(char) <= 32 or ord(char) == 127 for char in uri)):
            return False
        # Native desktop OAuth listeners choose an ephemeral loopback port.
        # Accept only literal loopback/localhost and Codex's callback paths;
        # Authlib still binds authorization and token exchange to the exact URI
        # registered by that client, in addition to mandatory PKCE S256.
        if (p.scheme == "http" and p.hostname in {"127.0.0.1", "localhost", "::1"}
                and (port is None or port > 0) and not p.netloc.endswith(":")
                and re.fullmatch(r"/callback(?:/[A-Za-z0-9_-]{1,128})?", p.path)):
            return True
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
        if not isinstance(method, str) or method not in {"none", "client_secret_basic", "client_secret_post"}:
            return jsonify(error="invalid_client_metadata"), 400
        requested_grants = body.get("grant_types", ["authorization_code"])
        if (not isinstance(requested_grants, list)
                or "authorization_code" not in requested_grants
                or any(not isinstance(grant, str) or grant not in {"authorization_code", "refresh_token"}
                       for grant in requested_grants)):
            return jsonify(error="invalid_client_metadata"), 400
        if body.get("response_types", ["code"]) != ["code"]:
            return jsonify(error="invalid_client_metadata"), 400
        if body.get("scope") not in (None, "", SCOPE):
            return jsonify(error="invalid_client_metadata"), 400
        secret = secrets.token_urlsafe(32) if method != "none" else ""
        client = Client(client_id=secrets.token_urlsafe(24), client_id_issued_at=int(time.time()),
                        client_secret=generate_password_hash(secret) if secret else "")
        metadata = dict(client_name="Celesol · Vimarx", redirect_uris=uris,
                        token_endpoint_auth_method=method, grant_types=["authorization_code", "refresh_token"],
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
            transactions = dict(session.get("authorizations", {}))
            expected = transactions.pop(digest(request.query_string.decode()), "")
            session["authorizations"] = transactions
            if not expected or not secrets.compare_digest(csrf, expected):
                return jsonify(error="invalid_request", error_description="Formulario vencido."), 400
            if set(request.form) - {"csrf", "username", "password", "approve", "remember"}:
                return jsonify(error="invalid_request"), 400
        try:
            grant = server.get_consent_grant()
        except OAuth2Error as error:
            return jsonify(error=error.error, error_description=error.description), 400
        g.oauth_redirect_uri = grant.redirect_uri
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
                    if request.form.get("remember") == "yes":
                        sessions.remember(user, username, password)
                    db.session.commit()
                    response = issuer_response(server.create_authorization_response(grant=grant, grant_user=user))
                    return response
                except UpstreamError as error:
                    error_message = str(error)
        csrf = secrets.token_urlsafe(32)
        transactions = dict(session.get("authorizations", {}))
        transactions[digest(request.query_string.decode())] = csrf
        session["authorizations"] = dict(list(transactions.items())[-5:])
        session.permanent = True
        return render_template("authorize.html", csrf=csrf, error=error_message,
                               resource=resource, client_name=grant.client.client_name,
                               username=request.form.get("username", "")[:128]), (401 if error_message else 200)

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
        return user if sessions.active(user) else None

    def challenge():
        metadata = f"{parsed.scheme}://{parsed.netloc}/.well-known/oauth-protected-resource{prefix}/mcp"
        value = (f'Bearer resource_metadata="{metadata}", scope="{SCOPE}", '
                 'error="invalid_token", error_description="Reconnect your Vimarx account."')
        message = request.get_json(silent=True) if request.method == "POST" else None
        if isinstance(message, dict) and message.get("method") == "tools/call":
            response = jsonify(jsonrpc="2.0", id=message.get("id"), result={
                "content": [{"type": "text", "text": "Volvé a conectar tu cuenta de Vimarx."}],
                "isError": True, "_meta": {"mcp/www_authenticate": [value]}})
        else:
            response = jsonify(error="invalid_token")
        response.status_code = 401
        response.headers["WWW-Authenticate"] = value
        return response

    @app.post(prefix + "/revoke")
    def revoke():
        # Possession is required, matching RFC7009's public-client token revocation.
        if rate_limit("revoke", 60):
            return jsonify(error="rate_limit_exceeded"), 429
        raw = request.form.get("token", "")
        item = db.session.execute(db.select(Token).where(
            (Token.access_token == digest(raw)) | (Token.refresh_token == digest(raw)))).scalar_one_or_none()
        if item:
            sessions.revoke(item.user_id)
        return "", 200

    @app.route(prefix + "/connections", methods=["GET", "POST"])
    def connections():
        error, disconnected = None, None
        if request.method == "POST":
            expected = session.pop("manage_csrf", "")
            if not expected or not secrets.compare_digest(request.form.get("csrf", ""), expected):
                error = "El formulario venció. Volvé a ingresar tus datos."
            elif rate_limit("manage", 5):
                return jsonify(error="rate_limit_exceeded"), 429
            else:
                username, password = request.form.get("username", "").strip(), request.form.get("password", "")
                if not username or len(username) > 128 or not password or len(password) > 512:
                    error = "Ingresá tu usuario y contraseña de Vimarx."
                else:
                    try:
                        vimarx.login(username, password)
                        ids = list(db.session.execute(db.select(PersistentSession.user_id).where(
                            PersistentSession.account_key == sessions.account_key(username))).scalars())
                        for user_id in ids:
                            sessions.revoke(user_id)
                        disconnected = len(ids)
                    except UpstreamError as failure:
                        error = str(failure)
        session["manage_csrf"] = secrets.token_urlsafe(32)
        session.permanent = True
        return render_template("connections.html", csrf=session["manage_csrf"],
                               error=error, disconnected=disconnected, resource=resource)

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
            if method == "tools/call":
                arguments = dict(params.get("arguments", {}))
                if params["name"] in {"query_entidad", "query_socios"}:
                    limit = arguments.get("limit")
                    if limit is None:
                        limit = 50
                    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
                        return rpc_error(message_id, -32602, "El límite debe estar entre 1 y 200.")
                    arguments["limit"] = limit
                    if any(isinstance(value, str) and (len(value) > 4096 or "\0" in value)
                           for value in arguments.values()):
                        return rpc_error(message_id, -32602, "El criterio de consulta es demasiado largo o inválido.")
                    forwarded = dict(forwarded, params=dict(params, arguments=arguments))
            upstream_token = sessions.token(user)
            old_encrypted = user.upstream_token
            db.session.commit()
            try:
                result = vimarx.rpc(upstream_token, forwarded, protocol)
            except UpstreamSessionExpired:
                # Only allowlisted reads get one retry; never retry permission errors.
                upstream_token = sessions.token(user, rejected_token=old_encrypted)
                result = vimarx.rpc(upstream_token, forwarded, protocol)
            if method == "tools/call":
                sessions.touch(user)
        except ReauthenticationRequired:
            return challenge()
        except UpstreamSessionExpired:
            sessions.revoke(user.id)
            return challenge()
        except UpstreamError as error:
            return rpc_error(message_id, -32000, str(error))
        if not isinstance(result, dict):
            return rpc_error(message_id, -32603, "Respuesta inesperada de Vimarx.")
        if method == "initialize" and isinstance(result.get("result"), dict):
            init = result["result"]
            init["capabilities"] = {"tools": {"listChanged": False}}
            init["serverInfo"] = {"name": "redunisol-vimarx-readonly", "version": "2.0.0"}
            init["instructions"] = (
                "Consultas de solo lectura de Mutual Celesol con los permisos del usuario conectado. "
                "Para registros de cualquier entidad: get_entidades, get_propiedades y query_entidad. "
                "Para las últimas solicitudes, descubrir la entidad Solicitud y su campo de fecha, "
                "luego query_entidad con ordenarPor descendente y limit 3. "
                "Las descripciones pueden mencionar métodos internos en PascalCase; usar los nombres "
                "snake_case de tools/list. No inventar resultados ni confundir metadatos con registros.")
        if method == "tools/list" and isinstance(result.get("result"), dict):
            tools = []
            for tool in result["result"].get("tools", []):
                if tool.get("name") in READ_TOOLS:
                    tool["annotations"] = dict(readOnlyHint=True, destructiveHint=False,
                                               idempotentHint=True, openWorldHint=False)
                    tool["securitySchemes"] = [{"type": "oauth2", "scopes": [SCOPE]}]
                    if tool["name"] in {"query_entidad", "query_socios"}:
                        properties = tool.get("inputSchema", {}).get("properties", {})
                        if "limit" in properties:
                            properties["limit"].update(default=50, minimum=1, maximum=200)
                    tools.append(tool)
            result["result"]["tools"] = tools
        return jsonify(result)

    @app.cli.command("revoke-account")
    @click.option("--username", required=True, prompt=True)
    def revoke_account(username):
        """Operator recovery for disabled users who cannot log in to the portal."""
        ids = list(db.session.execute(db.select(PersistentSession.user_id).where(
            PersistentSession.account_key == sessions.account_key(username))).scalars())
        for user_id in ids:
            sessions.revoke(user_id)
        print("Conexiones revocadas:", len(ids))

    @app.cli.command("cleanup")
    def cleanup():
        """Remove expired credentials and abandoned authorization transactions."""
        purge_expired()

    return app
