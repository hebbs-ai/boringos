// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Contact {
  resourceName: string;
  names?: { displayName: string; givenName?: string; familyName?: string }[];
  emailAddresses?: { value: string; type?: string }[];
  phoneNumbers?: { value: string; type?: string }[];
}

export interface ContactGroup {
  resourceName: string;
  name: string;
}
