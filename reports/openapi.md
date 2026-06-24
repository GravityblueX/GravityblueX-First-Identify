# TeamSync OpenAPI Contract

Generated: 2026-06-24T03:59:53.050Z
Status: `OK`
Operations: `27`
Protected: `23`
Public: `4`

## Gates

| Gate | Result | Detail |
|---|---|---|
| OpenAPI version | OK | 3.1.0 |
| operation count matches API surface | OK | 27/27 |
| bearer security scheme present | OK | components.securitySchemes.bearerAuth |
| protected operations require bearer auth | OK | 23 protected operations |
| public operations omit bearer auth | OK | 4 public operations |
| Express path params converted | OK | colon params converted to {param} |

## Reference Basis

- OpenAPI Specification 3.1 contract document
- Bearer authentication boundary expressed as securitySchemes
- Generated from local Express route inventory, not hand-maintained text

## Outputs

- `reports/openapi.json`
- `reports/openapi.md`
