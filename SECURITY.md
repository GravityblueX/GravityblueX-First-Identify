# Security And Maintenance Boundary

TeamSync is a learning and portfolio project for project management,
collaboration, analytics, and TypeScript full-stack engineering.

## Supported Use

- Local development and self-hosted demos.
- Internal project management experiments.
- Authorized testing in environments owned or controlled by the operator.
- Security review of this repository and its own deployment configuration.

## Out Of Scope

- Unsolicited testing against third-party services.
- Collecting or storing real secrets in demo data.
- Treating demo authentication defaults as production-ready credentials.
- Running the experimental enterprise service files as production controls
  without database schema, monitoring, and operational review.

## Reporting

Open an issue or private note with:

- affected area,
- reproduction steps,
- expected impact,
- suggested fix or mitigation.

Do not include live credentials, tokens, private keys, or personal data in
reports. Use redacted examples instead.

## Maintenance Gates

Before release-oriented changes, run:

```bash
npm run build
npm run test
```

The default TypeScript build is scoped to the app entrypoint and the modules it
actually imports. Experimental service files outside the runtime entrypoint are
kept as research material until their Prisma models and integration tests are
promoted into the main application path.
