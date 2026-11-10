"""Web Push transport; private VAPID keys stay in the installation's state root."""

import base64
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Literal

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException, webpush

logger = logging.getLogger("uvicorn.error")


class WebPushSender:
    def __init__(self, key_file: Path, subject: str) -> None:
        key_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not key_file.exists():
            generated = ec.generate_private_key(ec.SECP256R1())
            data = generated.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
            descriptor = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(data)
        key = serialization.load_pem_private_key(key_file.read_bytes(), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey):
            raise ValueError("Web Push needs an EC private key")
        public = key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        self.public_key = base64.urlsafe_b64encode(public).decode().rstrip("=")
        self._key_file = key_file
        self._subject = subject

    def send(
        self, subscription: dict[str, object], payload: dict[str, object]
    ) -> Literal["sent", "expired", "failed"]:
        identity = f"{payload['id']}:{payload['published_at']}"
        topic = (
            base64.urlsafe_b64encode(hashlib.sha256(identity.encode()).digest())
            .decode()
            .rstrip("=")[:32]
        )
        try:
            webpush(
                subscription_info=subscription,
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=str(self._key_file),
                vapid_claims={"sub": self._subject},
                timeout=5,
                ttl=86400,
                headers={"Topic": topic, "Urgency": "normal"},
            )
            return "sent"
        except WebPushException as exc:
            if exc.response is not None and exc.response.status_code in {404, 410}:
                return "expired"
            logger.warning("web push was not accepted; will retry")
            return "failed"
        except Exception:
            logger.warning("web push transport failed; will retry")
            return "failed"
