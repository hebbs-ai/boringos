# Google Drive (read-only)

When the Google connector has been granted the `drive.readonly` scope, you can list and inspect files in the user's Drive. Tool names: `drive.list_files`, `drive.get_file`.

## Tools

### drive.list_files
List files. Use Drive query syntax for filtering (e.g., `mimeType='application/pdf'`).

### drive.get_file
Get metadata for a specific file by ID.

## Guidelines
- Read-only in v1. No creating, modifying, or deleting files.
- Prefer `webViewLink` for sharing links instead of constructing URLs.
