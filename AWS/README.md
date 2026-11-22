# Historical AWS implementation

This folder preserves the original Lambda handlers and static frontend as migration reference. The maintained application is in [GCP](../GCP/README.md).

The source uses Lambda, S3, DynamoDB, and an API Gateway URL. It is not a complete AWS infrastructure template and is not included in the GCP test suite. Historical frontend/backend contract mismatches are described in the project report. The original `delete_photo.py` also retains its `ximport` typo; this archive is not presented as ready to deploy.

The downloaded Pillow Lambda layer, local sample photos, unrelated planning PDF, and old screenshots are excluded from Git. Their local copies remain untouched. Pillow is a normal dependency in the GCP implementation.
