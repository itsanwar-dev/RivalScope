# Content and ad imports

RivalScope accepts canonical JSON records. This is an import of records you supply, not an automated connection to a social network or a verified Meta Ads Library export. Translate a provider's output to this schema before importing it.

```json
{
  "posts": [
    {
      "platform": "instagram",
      "url": "https://www.instagram.com/p/example/",
      "date": "2026-10-20T12:00:00Z",
      "text": "A short customer review of our new collection",
      "likes": 120,
      "comments": 8,
      "shares": 4,
      "views": 1500
    }
  ],
  "ads": [
    {
      "id": "example-ad-id",
      "platform": "meta",
      "url": "https://www.facebook.com/ads/library/?id=example-ad-id",
      "startDate": "2026-08-01",
      "status": "active",
      "headline": "Our new collection",
      "creative": "Discover the collection today",
      "pageName": "Example competitor"
    }
  ]
}
```

Either `posts` or `ads` may be omitted. An empty array is allowed. Maximum sizes are 1,000 posts and 500 ads per import. Do not include account credentials, private personal data, or API tokens.

Posts require `platform`, `url`, `date`, and non-empty `text`. `id` is optional and is generated from the platform and URL when omitted. `likes`, `comments`, `shares`, and `views` are optional non-negative integer counts. Omit unknown metrics; zero means a measured zero. URLs and IDs must not repeat within the relevant platform. Post text and ad creative are limited to 20,000 characters.

Ads require `id`, `platform`, `url`, `startDate`, and `status` (`active` or `inactive`). Optional fields are `headline`, `creative`, `pageName`, and `endDate`. Only inactive ads may specify an end date, and it must be on or after the start date. Without an end date, an inactive ad's duration is unknown.

Supported platform values are `instagram`, `facebook`, `tiktok`, `youtube`, `linkedin`, `x`, `pinterest`, `website`, `meta`, and `other`. `twitter` normalizes to `x`; `web` normalizes to `website`.

Dates must be `YYYY-MM-DD` (UTC midnight) or an ISO date-time with an explicit timezone. Dates in the future, impossible dates and timezone-less timestamps are rejected. URLs must be absolute HTTP(S) URLs without embedded credentials. Imported URLs are references; importing does not fetch their content.

## How the report reads these records

- Content analysis uses a rolling 30-day UTC window ending at analysis time; it is not restricted to the previous calendar month. Older ads remain eligible for the longevity ranking.
- Top posts rank the supplied likes, comments and shares. Missing metrics remain unknown and partial counts are flagged. Views are separate from interactions. Interaction-to-view percentages are proxies, not verified traffic or conversion rates.
- Themes use keyword matching and include evidence URLs. Posts can have multiple themes, so theme percentages may sum above 100%.
- Active ads sort by earliest reported start date. Ties share a rank and all oldest active ads receive `Winner candidate`. This is a longevity signal in the imported sample, not verified performance or proof of uninterrupted delivery. Inactive ads are retained and never receive this label.
- Actual website traffic, conversions, profitability, spend and return on ad spend remain unknown without an appropriate analytics provider.
