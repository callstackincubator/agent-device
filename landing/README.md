# Agent Device Landing

Next.js App Router implementation for the new `agent-device.dev` marketing site.

## Development

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Validation

```bash
pnpm lint
pnpm build
```

## Notes

The Figma source file is treated as read-only. Local visual assets under `public/figma/` were exported from Figma screenshots so the site does not depend on short-lived Figma asset URLs.

## Figma Source Map

Source file: `Agent Device`, page `Website`, file key `Z6g76cuusJlN9s5agbZRpY`.

Use section-level screenshots and metadata instead of full-page exports. Full-page images are too large and make visual review harder. A current local audit lives in `/private/tmp/agent-device-figma-audit/`.

### Home

| Section | Figma node |
| --- | --- |
| Hero | `39:2482` |
| Nav | `40:6100` |
| Solutions | `39:2501` |
| Lanes | `40:3750` |
| Setup | `40:5567` |
| Cloud/Open | `40:5761` |
| Why | `40:5833` |
| Up-sell | `364:2753` |
| CTA | `40:6008` |
| Insights | `234:2608` |
| Footer | `40:6484` |

### Agentic QA

| Section | Figma node |
| --- | --- |
| Hero | `488:2260` |
| Nav | `488:2353` |
| Solutions | `488:2367` |
| Why | `489:6121` |
| Setup | `488:3121` |
| Solutions | `498:8028` |
| Solutions | `498:8303` |
| CTA | `488:4642` |
| Up-sell | `488:4584` |
| FAQ | `489:7808` |
| Insights | `488:4648` |
| Footer | `488:4695` |

### Agentic Development

| Section | Figma node |
| --- | --- |
| Hero | `498:8567` |
| Nav | `498:8583` |
| Solutions | `498:8597` |
| Why | `498:8627` |
| Setup | `498:8645` |
| Solutions | `498:8652` |
| Setup | `510:2992` |
| Cloud/Open | `510:4422` |
| CTA | `498:8698` |
| Up-sell | `498:8704` |
| FAQ | `498:8762` |
| Insights | `498:8778` |
| Footer | `498:8825` |

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
