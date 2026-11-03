"""Renew Vimarx logins on demand with a cross-process SQLite lease."""
import hashlib
import hmac
import json
import secrets
import time

from cryptography.fernet import InvalidToken
from sqlalchemy import update

from .models import PersistentSession, RefreshResponse, Token, UserSession, db
from .upstream import UpstreamAuthenticationError, UpstreamError


class ReauthenticationRequired(Exception):
    pass


class SessionService:
    def __init__(self, app, cipher, upstream):
        self.app, self.cipher, self.upstream = app, cipher, upstream

    @property
    def idle_seconds(self):
        return self.app.config["CONNECTION_IDLE_SECONDS"]

    def account_key(self, username):
        return hmac.new(self.app.secret_key.encode(),
                        (self.app.config["VIMARX_ORIGIN"] + "\0" + username).encode(),
                        hashlib.sha256).hexdigest()

    def active(self, user):
        if not user:
            return False
        remembered = db.session.get(PersistentSession, user.id)
        if not remembered:
            return user.is_active()
        now = int(time.time())
        return (not remembered.revoked_at and bool(remembered.credentials)
                and remembered.last_used_at + self.idle_seconds > now
                and (remembered.linked_at or remembered.created_at + 600 > now))

    def remember(self, user, username, password):
        now = int(time.time())
        db.session.add(PersistentSession(
            user_id=user.id, account_key=self.account_key(username),
            credentials=self.cipher.encrypt(json.dumps(
                {"username": username, "password": password}).encode()).decode(),
            created_at=now, last_used_at=now))

    def revoke(self, user_id):
        now = int(time.time())
        db.session.execute(update(PersistentSession).where(
            PersistentSession.user_id == user_id).values(
                credentials="", revoked_at=now, lease_id="", lease_until=0))
        db.session.execute(update(UserSession).where(UserSession.id == user_id).values(
            upstream_token="", expires_at=0))
        db.session.execute(update(Token).where(Token.user_id == user_id).values(
            access_token_revoked_at=now, refresh_token_revoked_at=now))
        db.session.query(RefreshResponse).filter_by(user_id=user_id).delete()
        db.session.commit()

    def touch(self, user):
        now = int(time.time())
        db.session.execute(update(PersistentSession).where(
            PersistentSession.user_id == user.id,
            PersistentSession.revoked_at == 0,
            PersistentSession.last_used_at < now - 60).values(last_used_at=now))
        db.session.commit()

    def token(self, user, rejected_token=None):
        user_id = user.id
        deadline = time.monotonic() + 26
        while True:
            db.session.expire_all()
            user = db.session.get(UserSession, user_id)
            remembered = db.session.get(PersistentSession, user_id)
            if not self.active(user):
                if remembered:
                    self.revoke(user_id)
                raise ReauthenticationRequired()
            current = user.upstream_token
            if (user.expires_at > time.time() + 120
                    and (rejected_token is None or current != rejected_token)):
                try:
                    return self.cipher.decrypt(current.encode()).decode()
                except InvalidToken:
                    self.revoke(user_id)
                    raise ReauthenticationRequired() from None
            if not remembered:
                # Legacy/non-remembered sessions can use their remaining lifetime.
                if rejected_token is None and user.is_active():
                    return self.cipher.decrypt(current.encode()).decode()
                raise ReauthenticationRequired()
            now = int(time.time())
            if remembered.retry_after > now:
                raise UpstreamError("Vimarx no está disponible. Intentá nuevamente en unos instantes.")
            lease = secrets.token_urlsafe(24)
            claimed = db.session.execute(update(PersistentSession).where(
                PersistentSession.user_id == user_id,
                PersistentSession.revoked_at == 0,
                PersistentSession.lease_until <= now).values(lease_id=lease, lease_until=now + 25))
            acquired = claimed.rowcount == 1
            db.session.commit()  # Never hold a database transaction during HTTPS.
            if acquired:
                break
            if time.monotonic() >= deadline:
                raise UpstreamError("La conexión se está renovando. Intentá nuevamente.")
            time.sleep(0.05)
        try:
            db.session.expire_all()
            remembered = db.session.get(PersistentSession, user_id)
            user = db.session.get(UserSession, user_id)
            if not self.active(user) or remembered.lease_id != lease:
                raise ReauthenticationRequired()
            # Another request may have completed renewal before this lease.
            if (user.expires_at > time.time() + 120
                    and (rejected_token is None or user.upstream_token != rejected_token)):
                return self.cipher.decrypt(user.upstream_token.encode()).decode()
            try:
                credentials = json.loads(self.cipher.decrypt(remembered.credentials.encode()))
            except (InvalidToken, ValueError, TypeError):
                self.revoke(user_id)
                raise ReauthenticationRequired() from None
            db.session.commit()
            token, expiry = self.upstream.login(credentials["username"], credentials["password"])
            changed = db.session.execute(update(UserSession).where(
                UserSession.id == user_id,
                db.exists().where(PersistentSession.user_id == user_id,
                                  PersistentSession.lease_id == lease,
                                  PersistentSession.revoked_at == 0)).values(
                    upstream_token=self.cipher.encrypt(token.encode()).decode(), expires_at=expiry))
            db.session.commit()
            if changed.rowcount != 1:
                raise ReauthenticationRequired()
            self.app.logger.info("vimarx_session_renewed")
            return token
        except UpstreamAuthenticationError:
            self.revoke(user_id)
            self.app.logger.warning("vimarx_credentials_rejected")
            raise ReauthenticationRequired() from None
        except UpstreamError:
            db.session.execute(update(PersistentSession).where(
                PersistentSession.user_id == user_id,
                PersistentSession.lease_id == lease).values(retry_after=int(time.time()) + 30))
            db.session.commit()
            raise
        finally:
            db.session.execute(update(PersistentSession).where(
                PersistentSession.user_id == user_id,
                PersistentSession.lease_id == lease).values(lease_id="", lease_until=0))
            db.session.commit()
