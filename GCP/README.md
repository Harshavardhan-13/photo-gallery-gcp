# GCP setup and deployment

The application uses Firebase Hosting, three second-generation Python Cloud Run functions, Cloud Storage, and Firestore Native mode. All resources are created in your selected Google Cloud project; the database, bucket, and functions use `us-central1`.

The original deployment is documented in the [project report](Cloud_Computing_Project_Summary_Report.pdf). Its IDs and URLs are historical. These instructions let you deploy an empty gallery into a new project.

## 1. Install dependencies and run checks

Prerequisites:

- Python 3.13 with `venv` support.
- Node.js 22 or later and npm.
- Google Cloud CLI (`gcloud`).
- A Google Cloud project you own with billing enabled.

From this directory:

```bash
npm ci
python3.13 -m venv functions/venv
functions/venv/bin/python -m pip install -r functions/requirements.txt
npm test
node --check public/app.js
```

`npm ci` installs the pinned Firebase CLI locally; no global Firebase install is needed. The 20 Python tests mock Storage and Firestore and do not require cloud access. They exercise image processing, the HTTP contract, and failure handling.

## 2. Choose and authenticate your project

Create a Google Cloud project and attach billing in the console. If the old project was permanently deleted, its ID cannot be reused. Choose your own unique ID and replace both example values below:

```bash
export GCP_PROJECT_ID="your-unique-project-id"
export GCP_ACCOUNT="your-google-account@example.com"

gcloud auth login "$GCP_ACCOUNT"
gcloud auth application-default login
gcloud config set project "$GCP_PROJECT_ID"
gcloud auth application-default set-quota-project "$GCP_PROJECT_ID"
npx firebase login
```

Use the same account for Firebase and Google Cloud. Accept the Firebase Terms in the Firebase console if prompted. The setup script adds Firebase to the existing project rather than creating a separate cloud project. Linking billing puts Firebase on its Blaze plan.

No credentials are committed. `functions/.env.example` shows the required resource names. The setup script writes your ignored project-specific environment file automatically. Application Default Credentials and service-account keys belong outside the repository.

## 3. Provision resources

```bash
bash scripts/setup.sh
```

This script performs cloud changes in `GCP_PROJECT_ID`:

1. Verifies billing and enables the required APIs.
2. Adds Firebase to the project if needed.
3. Creates the `(default)` Firestore Native database if absent.
4. Creates a Standard image bucket with uniform bucket-level access.
5. Creates `gallery-runtime` and grants `roles/datastore.user` on the project and `roles/storage.objectUser` on the bucket.
6. Grants `allUsers` the bucket's `roles/storage.objectViewer` role for public demo images.
7. Writes `functions/.env.<project-id>` containing `IMAGE_BUCKET` and `RUNTIME_SERVICE_ACCOUNT`.

The default bucket name is `<project-id>-gallery-images`. To choose a different globally unique name, set `GALLERY_BUCKET` before running setup. Billing verification errors stop the script and are distinguished from billing being disabled. An organization policy that forbids public access will prevent the public bucket grant; this demo requires that grant to display its image URLs anonymously.

The setup helper is for a project you control. Check errors before rerunning it; it is not a general infrastructure-state reconciler.

## 4. Deploy

```bash
bash scripts/deploy.sh
```

The deployment helper requires `GCP_PROJECT_ID`, reruns local checks, deploys the functions and Firestore rules, then deploys Hosting. If the CLI requests an Artifact Registry cleanup policy, choose a retention period such as one day. The policy applies to build images, not gallery photos.

Equivalent deployment commands, after local checks:

```bash
npx firebase deploy --project "$GCP_PROJECT_ID" --only functions,firestore:rules
npx firebase deploy --project "$GCP_PROJECT_ID" --only hosting
```

The CLI prints your Hosting URL. Hosting serves only the six files in `public/`; Python source, local environments, reports, and screenshots are outside that directory.

| Website route | Function |
| --- | --- |
| `POST /upload` | `upload_photo` |
| `GET /photos` | `list_photos` |
| `DELETE /photos/{photo_id}` | `delete_photo` |

`public/config.js` uses an empty API base URL for same-origin Hosting rewrites. For a frontend-only update, use the Hosting deployment command. There is no automatic deployment from GitHub.

### If function builds fail with missing build-service-account permissions

This happened during the original deployment. Identify the build from the failed deployment output rather than assuming the runtime account is the build account. Set `BUILD_ID` to that failed build's UUID:

```bash
export BUILD_ID="replace-with-the-failed-build-id"
BUILD_SA_RESOURCE="$(gcloud builds describe "$BUILD_ID" \
  --region=us-central1 \
  --project="$GCP_PROJECT_ID" \
  --format='value(serviceAccount)')"
BUILD_SA="${BUILD_SA_RESOURCE##*/}"
```

Confirm `BUILD_SA` is the service account shown for that build. If the failure is the documented missing builder-role issue, grant it the builder role and retry deployment:

```bash
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
  --member="serviceAccount:$BUILD_SA" \
  --role="roles/cloudbuild.builds.builder"
bash scripts/deploy.sh
```

This is a project-level permission change and is separate from the runtime's bucket/database roles. See [Cloud Run functions troubleshooting](https://docs.cloud.google.com/functions/docs/troubleshooting#build-service-account).

### Other messages from the original deployment

- The ADC quota-project mismatch was corrected with `set-quota-project`.
- Firebase's initial project list was empty until Firebase was added to the existing project.
- Temporary Flask discovery-server messages, `Terminated: 15`, and Node's `DEP0190` warning also appeared during a successful deployment; they were not the build-permission failure.
- `npm audit` reported 14 moderate findings in Firebase CLI dependencies. Compatible fixes left them unresolved. A proposed forced downgrade of Firebase CLI was not used. This is a historical audit result, not a current vulnerability-free guarantee.

The report retains the complete outputs and explains the distinction between resolved errors and acknowledged warnings.

## 5. Verify a deployment

1. Open the Hosting URL; a new project should show an empty gallery.
2. Upload a small image with a user and topic. Confirm one `full/` object, one `thumbs/` object, and one `photos/{photo_id}` Firestore document.
3. Upload photos for another user/topic and exercise individual and combined filters.
4. Open the overlay and standalone details page; switch themes and layouts.
5. Delete a photo and confirm that both live objects and the metadata document disappear.
6. Check missing fields, unsupported/invalid images, over-5-MiB files, and over-20-megapixel images. Verify errors do not create cloud records.
7. Check JPEG, PNG, WebP, mobile layout, and browser Console/Network behavior. Requests should use the Hosting origin and Google Cloud Storage, with no AWS requests.

These are checks to perform on your new deployment. The historical screenshots prove only their captured scenarios; they are not a claim that every check above was performed live.

## Data model and behavior

Upload requests contain `user_name`, `topic`, `filename`, `content_type`, and `image_base64`. The backend detects the actual image type rather than trusting the supplied MIME value. Originals retain their uploaded bytes. Thumbnails are JPEG, preserve aspect ratio, and flatten transparency onto white.

Firestore stores `photo_id`, `user_name`, `topic`, `filename`, `content_type`, `upload_time` (UTC), `full_path`, and `thumb_path`. Response URLs are generated from those paths. Listing returns `{"photos": [...]}` in newest-first order; an optional `topic` query filters records.

The backend returns JSON errors for invalid input, missing records, wrong methods, and cloud failures. Partial-upload cleanup checks metadata state before removing objects. Deletion tolerates missing objects and retains metadata until object deletion succeeds, supporting retries.

Firestore rules deny browser access; the functions use the runtime service account's IAM permissions. Public access to the functions and image objects is intentional for this anonymous college demonstration. There is no authentication, ownership enforcement, or rate limiting.

## Logs, billing, and cleanup

View function logs with:

```bash
npx firebase functions:log --project "$GCP_PROJECT_ID"
```

You can also inspect the services in Cloud Run and Logs Explorer. Avoid putting image base64 data or credentials into diagnostic logs.

Review Billing Reports and set a small alerts-only budget. Alerts notify you and do not cap spending. Zero minimum function instances reduces idle compute cost; Cloud Storage, Firestore, Artifact Registry, builds, and traffic have separate usage rules. See [Firebase pricing](https://firebase.google.com/pricing) and [billing budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets).

For permanent cleanup, first save any cloud data you need. Disable billing for the specific project in Billing, then shut that project down in IAM & Admin Settings. Deleting the Firebase project also deletes the underlying GCP project. Existing charges remain payable; some data can disappear before the end of the 30-day project recovery window. Keep your local source/report if you plan to rebuild. See [project deletion](https://docs.cloud.google.com/resource-manager/docs/delete-restore-projects).

Deleting this GCP deployment does not delete or stop any historical AWS resources.
