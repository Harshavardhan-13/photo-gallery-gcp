"""Photo gallery application logic, independent of its cloud HTTP entry points."""

import base64
import binascii
from datetime import datetime, timezone
from functools import lru_cache
from io import BytesIO
import logging
import os
import re
from urllib.parse import quote
import uuid
import warnings

from flask import jsonify
from google.api_core.exceptions import NotFound
from google.cloud import firestore, storage
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_BASE64_LENGTH = 4 * ((MAX_IMAGE_BYTES + 2) // 3)
MAX_REQUEST_BYTES = MAX_BASE64_LENGTH + 16 * 1024
MAX_IMAGE_PIXELS = 20_000_000
FORMATS = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"), "WEBP": ("webp", "image/webp")}
PHOTO_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
logger = logging.getLogger(__name__)


class InputError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


@lru_cache(maxsize=1)
def clients():
    return firestore.Client(), storage.Client().bucket(os.environ["IMAGE_BUCKET"])


def response(data, status=200):
    result = jsonify(data)
    result.status_code = status
    result.headers["Cache-Control"] = "no-store"
    result.headers["X-Content-Type-Options"] = "nosniff"
    return result


def endpoint(request, method, action):
    if request.method != method:
        result = response({"error": "Method not allowed"}, 405)
        result.headers["Allow"] = method
        return result
    try:
        return action(request)
    except InputError as exc:
        return response({"error": str(exc)}, exc.status)
    except Exception:
        logger.exception("Gallery operation failed")
        return response({"error": "Storage operation failed. Please try again."}, 503)


def required_text(data, field, limit):
    value = data.get(field)
    if not isinstance(value, str) or not value.strip():
        raise InputError(f"{field} is required")
    value = value.strip()
    if len(value) > limit:
        raise InputError(f"{field} must be at most {limit} characters")
    return value


def decode_image(encoded):
    if not isinstance(encoded, str) or not encoded:
        raise InputError("image_base64 is required")
    if len(encoded) > MAX_BASE64_LENGTH:
        raise InputError("Image must be at most 5 MiB", 413)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise InputError("image_base64 must contain valid base64") from None
    if len(raw) > MAX_IMAGE_BYTES:
        raise InputError("Image must be at most 5 MiB", 413)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as image:
                fmt = image.format
                if fmt not in FORMATS:
                    raise InputError("Choose a JPEG, PNG, or WebP image")
                if image.width * image.height > MAX_IMAGE_PIXELS:
                    raise InputError("Image must be at most 20 megapixels")
                image.verify()
            with Image.open(BytesIO(raw)) as image:
                image.seek(0)
                thumbnail = ImageOps.exif_transpose(image)
                thumbnail.thumbnail((400, 400), Image.Resampling.LANCZOS)
                # Flatten transparency onto white for a consistent JPEG thumbnail.
                rgba = thumbnail.convert("RGBA")
                rgb = Image.new("RGB", rgba.size, "white")
                rgb.paste(rgba, mask=rgba.getchannel("A"))
                buffer = BytesIO()
                rgb.save(buffer, format="JPEG", quality=85)
    except InputError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise InputError("Image is invalid or cannot be decoded") from None
    return raw, buffer.getvalue(), FORMATS[fmt]


def public_photo(item, bucket_name):
    result = dict(item)
    base = f"https://storage.googleapis.com/{bucket_name}/"
    result["full_url"] = base + quote(item["full_path"], safe="/")
    result["thumb_url"] = base + quote(item["thumb_path"], safe="/")
    return result


def upload(request):
    if request.content_length is not None and request.content_length > MAX_REQUEST_BYTES:
        raise InputError("Image must be at most 5 MiB", 413)
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise InputError("Request body must be a JSON object")
    user_name = required_text(data, "user_name", 100)
    topic = required_text(data, "topic", 100)
    filename = required_text(data, "filename", 255)
    # Detect actual image type rather than trusting the filename or MIME header.
    raw, thumbnail, (extension, content_type) = decode_image(data.get("image_base64"))
    photo_id = str(uuid.uuid4())
    item = {
        "photo_id": photo_id,
        "user_name": user_name,
        "topic": topic,
        "filename": filename,
        "content_type": content_type,
        "upload_time": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "full_path": f"full/{photo_id}.{extension}",
        "thumb_path": f"thumbs/{photo_id}.jpg",
    }
    db, bucket = clients()
    document = db.collection("photos").document(photo_id)
    attempted = []
    try:
        for path, content, mime in [(item["full_path"], raw, content_type),
                                    (item["thumb_path"], thumbnail, "image/jpeg")]:
            blob = bucket.blob(path)
            # Include even an upload that raises: the server may have persisted it.
            attempted.append(blob)
            blob.cache_control = "no-store"
            blob.upload_from_string(content, content_type=mime, if_generation_match=0)
        document.create(item)
    except Exception:
        # A metadata write can succeed remotely before a network error is raised.
        # Preserve a confirmed record and its images in that case.
        try:
            if document.get().exists:
                return response(public_photo(item, bucket.name), 201)
        except Exception:
            logger.exception("Cannot confirm metadata write; preserving objects for reconciliation: %s", photo_id)
            raise
        for blob in attempted:
            try:
                blob.delete()
            except NotFound:
                pass
            except Exception:
                logger.exception("Failed to clean up object %s", blob.name)
        raise
    return response(public_photo(item, bucket.name), 201)


def list_all(request):
    db, bucket = clients()
    query = db.collection("photos")
    topic = request.args.get("topic")
    if topic:
        query = query.where(filter=firestore.FieldFilter("topic", "==", topic))
    items = [public_photo(document.to_dict(), bucket.name) for document in query.stream()]
    items.sort(key=lambda item: item["upload_time"], reverse=True)
    return response({"photos": items})


def delete(request):
    parts = request.path.strip("/").split("/")
    if len(parts) != 2 or parts[0] != "photos" or not PHOTO_ID.fullmatch(parts[1]):
        raise InputError("A valid photo_id is required in /photos/{photo_id}")
    db, bucket = clients()
    document = db.collection("photos").document(parts[1])
    snapshot = document.get()
    if not snapshot.exists:
        raise InputError("Photo not found", 404)
    item = snapshot.to_dict()
    for path in (item["full_path"], item["thumb_path"]):
        try:
            bucket.blob(path).delete()
        except NotFound:
            pass
    # Keep metadata until both object deletions finish, allowing safe retries.
    document.delete()
    return response({"deleted": parts[1]})
