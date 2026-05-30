# OneDrive (via Microsoft 365 connector)

You can browse and read the user's OneDrive files. Tool names: `files.list_files`, `files.get_file`. This surface is read-only.

## Tools

### files.list_files
List files and folders. Behavior depends on the arguments:
- No arguments: lists the children of the drive root.
- `folderId`: lists the children of that folder.
- `query`: searches the whole drive by file name and content (folderId is ignored).

`top` controls page size (default 100). Each item reports name, size, last-modified time, web URL, and whether it is a file or folder.

### files.get_file
Fetch metadata for a single item by its drive item ID.

## Guidelines
- Distinguish files from folders by the presence of the `file` vs `folder` field on each item.
- Use `query` for "find the document called X" requests; use `folderId` to walk a known directory tree.
- This connector reads metadata only. It does not download file contents or upload.
