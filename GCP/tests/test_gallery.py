"""HTTP contract tests and injected cloud-failure tests; no credentials needed."""

import base64
from io import BytesIO
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

from flask import Flask, request
from google.api_core.exceptions import NotFound
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "functions"))
import gallery
import main


class GalleryTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        # The Functions Framework supplies the request argument in production.
        app.add_url_rule("/upload", "upload", lambda: main.upload_photo(request), methods=["POST", "GET"])
        app.add_url_rule("/photos", "list", lambda: main.list_photos(request), methods=["GET", "POST"])
        app.add_url_rule("/photos/<path:photo_id>", "delete", lambda photo_id: main.delete_photo(request), methods=["DELETE", "GET"])
        self.client = app.test_client()
        self.db = MagicMock()
        self.collection = self.db.collection.return_value
        self.document = self.collection.document.return_value
        self.document.get.return_value.exists = False
        self.bucket = MagicMock(name="bucket")
        self.bucket.name = "test-gallery"
        self.blobs = {}

        def blob(path):
            return self.blobs.setdefault(path, MagicMock(name=path))

        self.bucket.blob.side_effect = blob
        self.client_patch = patch.object(gallery, "clients", return_value=(self.db, self.bucket))
        self.client_patch.start()
        self.addCleanup(self.client_patch.stop)
        self.payload = {
            "user_name": "O'Brien <test>", "topic": "Nature", "filename": "photo.png",
            "content_type": "image/png", "image_base64": self.image_base64(),
        }

    @staticmethod
    def image_base64(fmt="PNG", size=(800, 600)):
        buffer = BytesIO()
        Image.new("RGB", size, "green").save(buffer, format=fmt)
        return base64.b64encode(buffer.getvalue()).decode()

    def upload(self, **changes):
        return self.client.post("/upload", json={**self.payload, **changes})

    def stored_photo(self):
        result = self.upload()
        self.assertEqual(result.status_code, 201)
        item = self.document.create.call_args.args[0]
        self.document.get.return_value.exists = True
        self.document.get.return_value.to_dict.return_value = item
        return item

    def test_upload_creates_original_thumbnail_and_metadata(self):
        result = self.upload()
        self.assertEqual(result.status_code, 201)
        item = self.document.create.call_args.args[0]
        self.assertTrue(gallery.PHOTO_ID.fullmatch(item["photo_id"]))
        self.assertEqual(item["user_name"], self.payload["user_name"])
        self.assertTrue(item["upload_time"].endswith("Z"))
        self.assertNotIn("full_url", item)
        original = self.blobs[item["full_path"]].upload_from_string.call_args
        self.assertEqual(original.args[0], base64.b64decode(self.payload["image_base64"]))
        thumb = self.blobs[item["thumb_path"]].upload_from_string.call_args.args[0]
        with Image.open(BytesIO(thumb)) as image:
            self.assertEqual(image.size, (400, 300))
            self.assertEqual(image.format, "JPEG")
        self.assertTrue(result.json["full_url"].startswith("https://storage.googleapis.com/test-gallery/full/"))
        self.assertEqual(result.headers["Cache-Control"], "no-store")

    def test_all_supported_image_formats(self):
        for fmt, content_type, extension in [("JPEG", "image/jpeg", ".jpg"),
                                              ("PNG", "image/png", ".png"),
                                              ("WEBP", "image/webp", ".webp")]:
            with self.subTest(fmt=fmt):
                result = self.upload(image_base64=self.image_base64(fmt), content_type="incorrect/type")
                self.assertEqual(result.status_code, 201)
                self.assertEqual(result.json["content_type"], content_type)
                self.assertTrue(result.json["full_path"].endswith(extension))

    def test_transparent_image_thumbnail(self):
        buffer = BytesIO()
        Image.new("RGBA", (10, 10), (0, 0, 0, 0)).save(buffer, "PNG")
        result = self.upload(image_base64=base64.b64encode(buffer.getvalue()).decode())
        thumb = self.blobs[result.json["thumb_path"]].upload_from_string.call_args.args[0]
        with Image.open(BytesIO(thumb)) as image:
            self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))

    def test_invalid_payloads_write_nothing(self):
        cases = [{"user_name": " "}, {"topic": ""}, {"filename": None},
                 {"user_name": "x" * 101}, {"image_base64": None},
                 {"image_base64": "bad!base64"},
                 {"image_base64": base64.b64encode(b"not an image").decode()},
                 {"image_base64": self.image_base64("GIF")}]
        for changes in cases:
            with self.subTest(changes=list(changes)):
                result = self.upload(**changes)
                self.assertEqual(result.status_code, 400)
                self.assertIn("error", result.json)
        self.document.create.assert_not_called()
        self.bucket.blob.assert_not_called()

    def test_invalid_json_and_non_object_body(self):
        for body in ["{", "[]", "null"]:
            result = self.client.post("/upload", data=body, content_type="application/json")
            self.assertEqual(result.status_code, 400)

    def test_oversized_upload(self):
        encoded = base64.b64encode(b"x" * (gallery.MAX_IMAGE_BYTES + 1)).decode()
        self.assertEqual(self.upload(image_base64=encoded).status_code, 413)
        self.bucket.blob.assert_not_called()

    def test_excessive_image_dimensions(self):
        with patch.object(gallery, "MAX_IMAGE_PIXELS", 100):
            self.assertEqual(self.upload().status_code, 400)

    def test_metadata_failure_cleans_up_both_objects(self):
        self.document.create.side_effect = RuntimeError("unavailable")
        with self.assertLogs("gallery", level="ERROR"):
            result = self.upload()
        self.assertEqual(result.status_code, 503)
        self.assertEqual(len(self.blobs), 2)
        for blob in self.blobs.values():
            blob.delete.assert_called_once()

    def test_partial_upload_failure_cleans_up_attempted_objects(self):
        count = 0

        def blob(path):
            nonlocal count
            count += 1
            result = self.blobs.setdefault(path, MagicMock(name=path))
            if count == 2:
                result.upload_from_string.side_effect = RuntimeError("upload interrupted")
            return result

        self.bucket.blob.side_effect = blob
        with self.assertLogs("gallery", level="ERROR"):
            result = self.upload()
        self.assertEqual(result.status_code, 503)
        self.document.create.assert_not_called()
        for blob in self.blobs.values():
            blob.delete.assert_called_once()

    def test_ambiguous_metadata_write_preserves_confirmed_success(self):
        self.document.create.side_effect = RuntimeError("connection lost after commit")
        self.document.get.return_value.exists = True
        self.assertEqual(self.upload().status_code, 201)
        for blob in self.blobs.values():
            blob.delete.assert_not_called()

    def test_unknown_metadata_status_preserves_objects_for_reconciliation(self):
        self.document.create.side_effect = RuntimeError("write interrupted")
        self.document.get.side_effect = RuntimeError("read interrupted")
        with self.assertLogs("gallery", level="ERROR"):
            self.assertEqual(self.upload().status_code, 503)
        for blob in self.blobs.values():
            blob.delete.assert_not_called()

    def test_empty_gallery(self):
        self.collection.stream.return_value = []
        result = self.client.get("/photos")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json, {"photos": []})

    def test_list_returns_urls_and_newest_first(self):
        item = self.stored_photo()
        older = {**item, "photo_id": "older", "upload_time": "2020-01-01T00:00:00Z"}
        self.collection.stream.return_value = [MagicMock(to_dict=lambda: older), MagicMock(to_dict=lambda: item)]
        result = self.client.get("/photos")
        self.assertEqual([p["photo_id"] for p in result.json["photos"]], [item["photo_id"], "older"])
        self.assertIn("thumb_url", result.json["photos"][0])

    def test_topic_filter_is_applied_in_firestore(self):
        self.collection.where.return_value.stream.return_value = []
        self.assertEqual(self.client.get("/photos?topic=Nature").status_code, 200)
        field_filter = self.collection.where.call_args.kwargs["filter"]
        self.assertEqual(field_filter.field_path, "topic")
        self.assertEqual(field_filter.value, "Nature")

    def test_delete_removes_both_objects_and_document(self):
        item = self.stored_photo()
        result = self.client.delete(f'/photos/{item["photo_id"]}')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json, {"deleted": item["photo_id"]})
        self.document.delete.assert_called_once()
        for blob in self.blobs.values():
            blob.delete.assert_called_once()

    def test_delete_tolerates_missing_objects(self):
        item = self.stored_photo()
        for blob in self.blobs.values():
            blob.delete.side_effect = NotFound("already gone")
        self.assertEqual(self.client.delete(f'/photos/{item["photo_id"]}').status_code, 200)
        self.document.delete.assert_called_once()

    def test_failed_delete_retains_metadata_and_can_be_retried(self):
        item = self.stored_photo()
        self.blobs[item["thumb_path"]].delete.side_effect = RuntimeError("unavailable")
        with self.assertLogs("gallery", level="ERROR"):
            self.assertEqual(self.client.delete(f'/photos/{item["photo_id"]}').status_code, 503)
        self.document.delete.assert_not_called()
        self.blobs[item["full_path"]].delete.side_effect = NotFound("already gone")
        self.blobs[item["thumb_path"]].delete.side_effect = None
        self.assertEqual(self.client.delete(f'/photos/{item["photo_id"]}').status_code, 200)
        self.document.delete.assert_called_once()

    def test_missing_and_invalid_ids(self):
        missing_id = "ed420705-1176-4d7d-9428-4a6209a125f6"
        self.assertEqual(self.client.delete(f"/photos/{missing_id}").status_code, 404)
        self.assertEqual(self.client.delete("/photos/invalid").status_code, 400)
        self.assertEqual(self.client.delete("/photos/a/b").status_code, 400)

    def test_wrong_methods(self):
        for method, path, allow in [("get", "/upload", "POST"),
                                    ("post", "/photos", "GET"),
                                    ("get", "/photos/invalid", "DELETE")]:
            result = getattr(self.client, method)(path)
            self.assertEqual(result.status_code, 405)
            self.assertEqual(result.headers["Allow"], allow)

    def test_list_storage_error_is_json(self):
        self.collection.stream.side_effect = RuntimeError("unavailable")
        with self.assertLogs("gallery", level="ERROR"):
            result = self.client.get("/photos")
        self.assertEqual(result.status_code, 503)
        self.assertIn("error", result.json)


if __name__ == "__main__":
    unittest.main()
