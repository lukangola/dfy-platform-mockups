# Character Library — Default / Shared Tier

Drop character reference images directly into this folder. On server boot,
every new file is uploaded to fal.storage and inserted into the `characters`
table with `brand_id = NULL` — meaning **every brand sees them** in the
Character B-roll picker's *Default Library* section.

Brand-private characters (uploaded via the UI) are **not** stored here — they
live only in the database with a non-null `brand_id`.

## Supported formats

`.png`, `.jpg`, `.jpeg`, `.webp`

Filenames are kept as-is for the `title` field (extension stripped, dashes /
underscores converted to spaces).

## How ingest works

1. Server scans this folder on boot.
2. Each file is hashed (size + mtime). New or changed files are uploaded to
   fal.storage and a row is inserted with `brand_id = NULL`.
3. Already-ingested files (matching size + mtime) are skipped.
4. Files added after the server started can be picked up by hitting
   `POST /api/characters/rescan`.

Default-library rows cannot be deleted via the API (the route returns 403).
To remove a default character, delete the file from this folder and remove
the row directly via SQL.
