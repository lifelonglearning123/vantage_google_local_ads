/** What a client's Private Integration token needs. Its own module so the connect form can show it without loading the API client. */
export const REQUIRED_SCOPES = [
  "opportunities.readonly",
  "opportunities.write",
  "contacts.readonly",
  "contacts.write",
  "locations.readonly",
];
