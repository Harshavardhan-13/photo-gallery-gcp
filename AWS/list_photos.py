import os
import json
import boto3

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["PHOTOS_TABLE"])
image_bucket = os.environ["IMAGE_BUCKET"]

def lambda_handler(event, context):
    query_params = event.get("queryStringParameters") or {}
    topic_filter = query_params.get("topic") if query_params else None

    resp = table.scan()
    items = resp.get("Items", [])

    if topic_filter:
        items = [item for item in items if item.get("topic") == topic_filter]

    # Add thumbnail URL
    for item in items:
        thumb_key = item.get("s3_key_thumb")
        if thumb_key:
            item["thumb_url"] = f"https://{image_bucket}.s3.amazonaws.com/{thumb_key}"

    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps(items)
    }

x