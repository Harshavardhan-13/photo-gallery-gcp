04 API and Firestore Before Deletion
============================================================

Backend evidence before deletion. The API initially lists one photo and later three; Firestore shows the same three photo records.

01_API_One_Photo_Response.png
  The /photos API returns the first photo, metadata, and Google Cloud Storage image URLs.
  Original: Screenshot 2026-11-21 at 8.26.52 PM.png

02_API_Three_Photos_Response.png
  The /photos API returns all three uploaded photos before deletion.
  Original: Screenshot 2026-11-21 at 8.29.55 PM.png

03_Firestore_Three_Documents_Before_Deletion.png
  Firestore lists three photo documents; the selected Nature document contains the expected metadata and object paths.
  Original: Screenshot 2026-11-21 at 8.32.04 PM.png
