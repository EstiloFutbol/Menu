// Lee CHANGELOG.md: cada versión empieza con "## 0.4.0 — 2026-11-22" y sus
// cambios son las líneas "- …" que siguen (los párrafos sueltos se ignoran).
export type ChangelogEntry = { version: string; date: string; changes: string[] }

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(\d+\.\d+\.\d+)\s*(?:[—–-]\s*(\d{4}-\d{2}-\d{2}))?/)
    if (heading) {
      entries.push({ version: heading[1], date: heading[2] ?? '', changes: [] })
      continue
    }
    const item = line.match(/^-\s+(.+)$/)
    if (item && entries.length) entries[entries.length - 1].changes.push(item[1].trim())
  }
  return entries
}

// "2026-11-22" → "22/11/2026"
export function formatChangelogDate(date: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date
}
