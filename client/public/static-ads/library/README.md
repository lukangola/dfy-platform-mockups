# Static Ad Reference Library

Drop static-ad reference images directly into this folder. On server boot,
every new file is uploaded to fal.storage, inserted into the
`static_ad_references` table, and automatically deconstructed via the
`static_ad_deconstruct` master prompt.

## Supported formats

`.png`, `.jpg`, `.jpeg`, `.webp`

Filenames are kept as-is for the `title` field (extension stripped, dashes /
underscores converted to spaces).

## Niche / categorization

Niche is a **database property**, not a folder. New references are ingested
with `niche: "unassigned"`. Assign the niche later via:

```
PATCH /api/static-ad-references/:id
{ "niche": "skincare" }
```

You can edit the title the same way.

## How ingest works

1. Server scans this folder on boot.
2. Each file is hashed (size + mtime). New or changed files are uploaded to
   fal.storage and a row is inserted with `deconstructionStatus = "pending"`.
3. A background job calls the `static_ad_deconstruct` master prompt with the
   uploaded image URL and writes the result to `deconstruction`.
4. Already-ingested files (matching size + mtime) are skipped.

Delete a row via the API to remove it from the library — the source file on
disk will be re-ingested on next boot unless you also delete the file.
