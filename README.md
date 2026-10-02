**Live: https://naman-singh-777.github.io/Portfolio-Websiteeeee/**

> All rights reserved. This code is shared publicly for portfolio review only -- see [LICENSE](./LICENSE).

# Naman Singh: Interactive 3D Driving Portfolio

Vite + TypeScript + Three.js + Rapier3D client-side driving demo built over a Blender-authored
environment. Drive a car through the world to reach projects, music and socials.

## Dev
```
npm install
npm run dev
```

## Build
```
npm run build   # outputs dist/
npm run preview
```

## Deploy
Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds with Vite and publishes
to GitHub Pages automatically. One-time setup (already done if you're reading this after the
first push): in the repo, go to **Settings -> Pages -> Build and deployment -> Source** and pick
**GitHub Actions**.

### Optional: also deploy to AWS S3
The same workflow has a second, dormant `deploy-s3` job (static website hosting via S3) that
activates the next time it runs once these repo secrets exist (**Settings -> Secrets and
variables -> Actions -> New repository secret**):
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET` (bucket name, already created with static-website-hosting enabled)
- `AWS_REGION` (optional, defaults to `us-east-1`)

Until those secrets are added, that job is skipped automatically and never fails the pipeline.

## SEO
`index.html` carries title/description/Open Graph/Twitter meta tags, and `public/robots.txt` +
`public/sitemap.xml` point crawlers at the site. After the first deploy, submit the URL at
[Google Search Console](https://search.google.com/search-console) for faster indexing.

## Controls
WASD or Arrow keys. W/Up = accelerate, S/Down = reverse, A/D or Left/Right = steer.

## Structure
- `src/scene/`: GLTF load, sky/stars, lighting
- `src/vehicle/`: Rapier vehicle controller, input, chase camera
- `src/collision/`: name-pattern-driven static colliders (railings/roads/buildings/cliffs)
- `src/config/externalLinks.ts`: empty, dormant hook for future clickable links
- `public/assets/environment.glb`: exported from `bruno_night_environment.blend` (SKY_DOME excluded; sky/stars are rebuilt procedurally in `scene/sky.ts` since the dome's node-shader stars/volumetrics don't survive glTF export)

## Known gap
`Baclight` material's `bkemit.png` texture was already missing from the source car asset before export (noted during car integration), cosmetic only.
