import os
import json
import boto3

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["PHOTOS_TABLE"])
s3 = boto3.client("s3")
image_bucket = os.environ["IMAGE_BUCKET"]

def lambda_handler(event, context):
    method = event["requestContext"]["http"]["method"]
    if method == "OPTIONS":
        return _cors_response(200, "")

    if method != "DELETE":
        return _cors_response(405, "Method Not Allowed")

    params = event.get("queryStringParameters") or {}
    photo_id = params.get("photo_id")
    if not photo_id:
        return _cors_response(400, "photo_id is required")

    resp = table.get_item(Key={"photo_id": photo_id})
    item = resp.get("Item")
    if not item:
        return _cors_response(404, "Photo not found")

    if "s3_key_full" in item:
        s3.delete_object(Bucket=image_bucket, Key=item["s3_key_full"])
    if "s3_key_thumb" in item:
        s3.delete_object(Bucket=image_bucket, Key=item["s3_key_thumb"])

    table.delete_item(Key={"photo_id": photo_id})

    return _cors_response(200, "Deleted")

def _cors_response(status, body, content_type="text/plain"):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": content_type,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        "body": body
    }
