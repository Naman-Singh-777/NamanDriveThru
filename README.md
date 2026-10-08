**Live:** https://naman-singh-777.github.io/NamanDriveThru/

> All rights reserved — shared publicly for portfolio review only. See [LICENSE](./LICENSE).

# NamanDriveThru

*Sleep Was Not Consulted.* Naman Singh's interactive 3D driving portfolio (also written Naman Drive Thru, previously NOT ANOTHER PORTFOLIO WEBSITE).

Why scroll through a resume when you can drive through one? A Three.js + Rapier3D driving demo, built over a Blender-authored environment, that reaches projects, music, and contact links by exploring a 3D world instead of scrolling a page.

## Controls
WASD or arrow keys to drive, Space to brake. Works on touch devices too.

## Tech stack
Vite, TypeScript, Three.js, Rapier3D physics, environment authored in Blender.

## Project structure
- `src/scene/` — environment loading, sky/stars, lighting
- `src/vehicle/` — vehicle physics, input, chase camera
- `src/collision/` — static colliders for roads, buildings, railings
- `public/assets/` — exported 3D environment

## Local development
```
npm install
npm run dev
```
```
npm run build   # outputs dist/
npm run preview
```
Deploys automatically to GitHub Pages via GitHub Actions on every push to `main`.
