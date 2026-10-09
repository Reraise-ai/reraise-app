# Board API rate limits

Decision: [ADR-0047](../adr/0047-api-rate-limiting.md). The limits apply to every route and to
`/mcp`; `/health` and CORS preflights are exempt. They live in the service process and reset on
restart. The order of checks is: Host and Origin, then the request limit, then authentication
(with the failed-credential count).

| Limit | Default | Counted per | Over the limit |
| --- | --- | --- | --- |
| Requests | 600 per 60 seconds | credential (session token or agent token), or the address when no credential is sent | `429` for the rest of the window |
| Failed credentials | 10 per 60 seconds | client address | `429` instead of `401` for every request from that address that fails authentication, until the window ends; requests with a valid credential still pass |

The board polls every 2 seconds (30 requests a minute), far under the default.

## The 429 response

An RFC 9457 problem with `Content-Type: application/problem+json`:

```json
{
  "type": "https://worldbuilder.invalid/problems/too-many-requests",
  "title": "Too many requests",
  "status": 429,
  "detail": "too many requests; retry later"
}
```

`Retry-After` holds the seconds to wait. `Retry-After` and the `x-ratelimit-*` headers are exposed to
the board's origin through `Access-Control-Expose-Headers`. The OpenAPI document declares this response on every
operation (`TooManyRequests`).

## Configuration

```text
worldbuilder serve --store <path> --rate-limit 1200 --auth-failure-limit 20
```

`--rate-limit` is requests per minute per credential, `--auth-failure-limit` is failed
credentials per minute per address; both take an integer from 1 to 1000000. Embedders set the
`rateLimit` option of `createService` (`max`, `windowMs`, `authFailureMax`, or `false` to switch
the limits off, for tests).
