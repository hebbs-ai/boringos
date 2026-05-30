// SPDX-License-Identifier: AGPL-3.0-or-later

// A Microsoft Graph contact resource (subset).
// https://learn.microsoft.com/graph/api/resources/contact
export interface Contact {
  id: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  emailAddresses?: { address: string; name?: string }[];
  businessPhones?: string[];
  mobilePhone?: string;
  companyName?: string;
  jobTitle?: string;
}

// A Graph person resource from /me/people (relevance-ranked).
// https://learn.microsoft.com/graph/api/resources/person
export interface Person {
  id: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  scoredEmailAddresses?: { address: string; relevanceScore?: number }[];
  companyName?: string;
  jobTitle?: string;
}
