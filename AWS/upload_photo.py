import os
import json
import uuid
import base64
from datetime import datetime
import boto3

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["PHOTOS_TABLE"])
image_bucket = os.environ["IMAGE_BUCKET"]

def lambda_handler(event, context):
    method = event["requestContext"]["http"]["method"]
    if method == "OPTIONS":
        return _cors_response(200, "")

    if method != "POST":
        return _cors_response(405, "Method Not Allowed")

    body = event.get("body", "")
    is_b64 = event.get("isBase64Encoded", False)
    if is_b64:
        body = base64.b64decode(body).decode("utf-8")

    data = json.loads(body)

    user_name = data.get("user_name")
    topic = data.get("topic")
    full_b64 = data.get("full_image_base64")
    thumb_b64 = data.get("thumb_image_base64")

    if not (user_name and topic and full_b64 and thumb_b64):
        return _cors_response(400, "Missing fields")

    photo_id = str(uuid.uuid4())
    upload_time = datetime.utcnow().isoformat() + "Z"

    full_bytes = base64.b64decode(full_b64)
    thumb_bytes = base64.b64decode(thumb_b64)

    full_key = f"full/{photo_id}.jpg"
    thumb_key = f"thumbs/{photo_id}.jpg"

    s3.put_object(
        Bucket=image_bucket,
        Key=full_key,
        Body=full_bytes,
        ContentType="image/jpeg"
    )

    s3.put_object(
        Bucket=image_bucket,
        Key=thumb_key,
        Body=thumb_bytes,
        ContentType="image/jpeg"
    )

    table.put_item(
        Item={
            "photo_id": photo_id,
            "user_name": user_name,
            "topic": topic,
            "upload_time": upload_time,
            "s3_key_full": full_key,
            "s3_key_thumb": thumb_key
        }
    )

    result = {
        "photo_id": photo_id,
        "user_name": user_name,
        "topic": topic,
        "upload_time": upload_time
    }

    return _cors_response(200, json.dumps(result), content_type="application/json")

def _cors_response(status, body, content_type="text/plain"):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": content_type,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        "body": body
    }
