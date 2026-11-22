06 After Deletion
============================================================

Read these five screenshots together. The Nature photo is deleted; the two Travel photos remain consistently in the website, API, database, full/ folder, and thumbs/ folder.

01_Gallery_Two_Remaining_Photos.png
  After deletion, the gallery shows the two Travel photos. The Nature photo is absent.
  Original: Screenshot 2026-11-21 at 8.40.22 PM.png

02_API_Two_Remaining_Photos.png
  After deletion, /photos returns only Alice / Travel and Bob / Travel.
  Original: Screenshot 2026-11-21 at 8.44.01 PM.png

03_Firestore_Two_Documents_Nature_Deleted.png
  Firestore lists two remaining documents. The selected deleted Nature document says it does not exist; this is the expected result.
  Original: Screenshot 2026-11-21 at 8.41.42 PM.png

04_Storage_Full_Two_Live_Originals.png
  The full/ folder contains the two remaining live originals, matching the remaining API photo IDs.
  Original: Screenshot 2026-11-21 at 8.42.43 PM.png

05_Storage_Thumbs_Two_Live_Thumbnails.png
  The thumbs/ folder contains the two matching live JPEG thumbnails. The deleted Nature thumbnail is absent.
  Original: Screenshot 2026-11-21 at 8.55.49 PM.png
