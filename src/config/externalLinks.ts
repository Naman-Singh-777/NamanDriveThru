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
// - spotifyEmbeds: official public Spotify embed(s) for the Platform
//   overlay — no OAuth/client-ID/developer setup needed. `type` matches
//   the segment right after open.spotify.com/embed/ in the share/embed
//   link (playlist | album | track | artist), `id` is the id after that.
//   The official embed widget already shows its own tracklist/player and
//   auto-advances through the album/playlist on its own — no extra code
//   needed for "next track" behaviour. Each embed's <iframe> is created
//   once and kept alive in a persistent off-screen holder (see overlay.ts)
//   so playback is NOT interrupted when the overlay is closed — the music
//   keeps playing in the background while driving, same as leaving a
//   Spotify tab open, until the visitor pauses it themselves or picks a
//   different embed. It plays 30s previews for anonymous visitors and full
//   tracks for a visitor already logged into Spotify in their browser
//   (Premium). Full playback for every visitor without their own Spotify
//   login would need the Web Playback SDK + Spotify OAuth (a client ID +
//   registered redirect URI from the Spotify developer dashboard, plus
//   Premium) — ask before switching to that; nothing here requires it.
// - social: plain URLs / mailto targets for the City overlay. `email` and
//   `email2` are both shown (labelled separately) when both are set.

export interface SocialLinks {
  github?: string
  linkedin?: string
  instagram?: string
  email?: string
  email2?: string
}

export interface SpotifyEmbed {
  type: 'playlist' | 'album' | 'track' | 'artist'
  id: string
}

export interface ExternalLinksConfig {
  githubUsername: string
  driveUrl?: string
  driveLabel?: string
  spotifyEmbeds: SpotifyEmbed[]
  social: SocialLinks
}

export const externalLinks: ExternalLinksConfig = {
  githubUsername: 'Naman-Singh-777',
  driveUrl: 'https://drive.google.com/drive/folders/1mJOH3iWV90vZh4YiZP45dGCuGfVY3MhK?usp=drive_link',
  driveLabel: 'Video Portfolio',
  spotifyEmbeds: [{ type: 'album', id: '2nVPmbiBiR3CrAqDnw1inZ' }],
  social: {
    github: 'https://github.com/Naman-Singh-777',
    linkedin: 'https://linkedin.com/in/naman-singh-164478296',
    instagram: 'https://www.instagram.com/fluffy_sox3000/?hl=en',
    email: 'nsingh1_be23@thapar.edu',
    email2: 'namansinghfigo349@gmail.com'
  }
}
