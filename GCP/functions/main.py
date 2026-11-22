"""Three second-generation HTTP functions deployed through Firebase."""

import os

from firebase_functions import https_fn, options

import gallery

options.set_global_options(
    region="us-central1",
    memory=options.MemoryOption.MB_512,
    timeout_sec=60,
    min_instances=0,
    max_instances=2,
    concurrency=1,
    service_account=os.environ.get("RUNTIME_SERVICE_ACCOUNT"),
)


@https_fn.on_request(invoker="public")
def upload_photo(request: https_fn.Request) -> https_fn.Response:
    return gallery.endpoint(request, "POST", gallery.upload)


@https_fn.on_request(invoker="public")
def list_photos(request: https_fn.Request) -> https_fn.Response:
    return gallery.endpoint(request, "GET", gallery.list_all)


@https_fn.on_request(invoker="public")
def delete_photo(request: https_fn.Request) -> https_fn.Response:
    return gallery.endpoint(request, "DELETE", gallery.delete)
