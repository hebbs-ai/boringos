// SPDX-License-Identifier: AGPL-3.0-or-later

// A Microsoft Graph driveItem resource (subset).
// https://learn.microsoft.com/graph/api/resources/driveitem
export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  createdDateTime?: string;
  // Present on files; absent on folders.
  file?: { mimeType?: string };
  // Present on folders; absent on files.
  folder?: { childCount?: number };
  parentReference?: { id?: string; path?: string; driveId?: string };
}
