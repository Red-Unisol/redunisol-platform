import hashlib
import time

from authlib.integrations.sqla_oauth2 import (
    OAuth2AuthorizationCodeMixin,
    OAuth2ClientMixin,
    OAuth2TokenMixin,
)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash

db = SQLAlchemy()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class UserSession(db.Model):
    id = db.Column(db.String(64), primary_key=True)
    upstream_token = db.Column(db.Text, nullable=False)
    expires_at = db.Column(db.Integer, nullable=False)

    def get_user_id(self):
        return self.id

    def is_active(self):
        return self.expires_at > time.time() + 15


class Client(db.Model, OAuth2ClientMixin):
    id = db.Column(db.Integer, primary_key=True)

    def check_client_secret(self, client_secret):
        return bool(self.client_secret) and check_password_hash(
            self.client_secret, client_secret
        )


class Code(db.Model, OAuth2AuthorizationCodeMixin):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(64), nullable=False)
    resource = db.Column(db.Text, nullable=False)
    consumed = db.Column(db.Boolean, default=False, nullable=False)


class Token(db.Model, OAuth2TokenMixin):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(64), nullable=False)
    resource = db.Column(db.Text, nullable=False)


class RateBucket(db.Model):
    key = db.Column(db.String(64), primary_key=True)
    window = db.Column(db.Integer, nullable=False)
    attempts = db.Column(db.Integer, nullable=False)
