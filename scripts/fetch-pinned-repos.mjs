// Writes public/pinned-repos.json from the GitHub profile's pinned repositories.
// Runs before every build (predev / prebuild / the deploy workflow), so the Port
// "Projects" list follows whatever is pinned on the profile at build time.
//
// With GH_TOKEN / GITHUB_TOKEN set it asks the GraphQL API (pinnedItems), otherwise it
// reads the public profile page. If both fail it leaves the existing file alone and
// exits 0, so an offline build never breaks.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const USER = 'Naman-Singh-777'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'pinned-repos.json')
const UA = { 'User-Agent': 'pinned-repos-sync' }

const decode = (s) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

async function viaGraphQL(token) {
  const query = `query { user(login: "${USER}") { pinnedItems(first: 6, types: REPOSITORY) { nodes { ... on Repository { name description url } } } } }`
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...UA, Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  })
  if (!res.ok) throw new Error(`graphql ${res.status}`)
  const json = await res.json()
  const nodes = json?.data?.user?.pinnedItems?.nodes
  if (!Array.isArray(nodes)) throw new Error('graphql: no pinnedItems')
  return nodes.filter(Boolean).map((n) => ({ name: n.name, description: n.description || '', href: n.url }))
}

async function viaProfilePage() {
  const res = await fetch(`https://github.com/${USER}`, { headers: UA })
  if (!res.ok) throw new Error(`profile ${res.status}`)
  const html = await res.text()
  const blocks = html.split('pinned-item-list-item-content').slice(1)
  const repos = []
  for (const b of blocks) {
    const href = /href="\/([^"\/]+\/[^"\/]+)"/.exec(b)
    const name = /<span class="repo"[^>]*>([^<]+)<\/span>/.exec(b)
    const desc = /<p class="pinned-item-desc[^"]*">([\s\S]*?)<\/p>/.exec(b)
    if (!href || !name) continue
    repos.push({ name: decode(name[1]), description: desc ? decode(desc[1]) : '', href: `https://github.com/${href[1]}` })
  }
  if (!repos.length) throw new Error('profile: no pinned items found')
  return repos
}

async function main() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  let repos = null
  if (token) {
    try {
      repos = await viaGraphQL(token)
    } catch (e) {
      console.warn(`[pinned] graphql failed (${e.message}), trying the profile page`)
    }
  }
  if (!repos) {
    try {
      repos = await viaProfilePage()
    } catch (e) {
      console.warn(`[pinned] could not refresh (${e.message}); keeping ${existsSync(OUT) ? 'the existing file' : 'nothing'}`)
      return
    }
  }
  const next = JSON.stringify({ repos }, null, 2) + '\n'
  const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (prev !== next) writeFileSync(OUT, next)
  console.log(`[pinned] ${repos.length} pinned: ${repos.map((r) => r.name).join(', ')}${prev === next ? ' (unchanged)' : ' (updated)'}`)
}

main().catch((e) => {
  console.warn(`[pinned] ${e.message}`)
})