// WEB-PHASE-4: single source of truth for the three checkpoint overlays'
// content. Deliberately plain data, no secrets — nothing here is a token or
// password. Leave a field empty/[] and the corresponding overlay renders a
// quiet "not configured yet" state instead of fabricated content.
//
// - githubUsername: used client-side to fetch PINNED repos for the Port
//   overlay. GitHub's public REST API has no unauthenticated endpoint for
//   pinned repos (that's GraphQL-only, and GraphQL requires a token — which
//   this static client-side site must never embed, per WEB-PHASE-4 security
//   rules). We call the no-auth, read-only community endpoint
//   https://gh-pinned-repos.egoist.dev (same approach used by most
//   "pinned repos" GitHub-profile widgets); as of WEB-PHASE-4 REDO Phase 9
//   that endpoint is confirmed dead, so Port falls back to a hand-updated
//   snapshot of the real pinned repos (PINNED_REPOS_FALLBACK in
//   src/overlay.ts) whenever the live call fails — never a "recently
//   pushed"/non-pinned substitute, and never a bare error message. See
//   src/overlay.ts.
// - driveUrl/driveLabel: an extra, separately-headed link shown above the
//   Port project menu (e.g. a video portfolio folder) — optional, omitted
//   entirely when driveUrl is empty.
// - Platform's music is no longer configured here (WEB-PHASE-4 REDO
//   Phase 11 replaced the Spotify embed entirely) — it's 100% auto-
//   discovered from public/assets/music/<folder>/ at build time by
//   scripts/generate-music-manifest.mjs into manifest.json, consumed by
//   src/vehicle/musicPlayer.ts. Drop a new folder (containing a cover image
//   and the song files) in and it shows up automatically; nothing in this
//   file or anywhere else needs touching for that.
// - social: plain URLs / mailto targets for the City overlay. `email` and
//   `email2` are both shown (labelled separately) when both are set.

export interface SocialLinks {
  github?: string
  linkedin?: string
  instagram?: string
  email?: string
  email2?: string
}

export interface ExternalLinksConfig {
  githubUsername: string
  driveUrl?: string
  driveLabel?: string
  social: SocialLinks
}

export const externalLinks: ExternalLinksConfig = {
  githubUsername: 'Naman-Singh-777',
  driveUrl: 'https://drive.google.com/drive/folders/1mJOH3iWV90vZh4YiZP45dGCuGfVY3MhK?usp=drive_link',
  driveLabel: 'Video Portfolio',
  social: {
    github: 'https://github.com/Naman-Singh-777',
    linkedin: 'https://linkedin.com/in/naman-singh-164478296',
    instagram: 'https://www.instagram.com/fluffy_sox3000/?hl=en',
    email: 'nsingh1_be23@thapar.edu',
    email2: 'namansinghfigo349@gmail.com'
  }
}
