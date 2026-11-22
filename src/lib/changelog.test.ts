import { describe, expect, it } from 'vitest'
import changelog from '../../CHANGELOG.md?raw'
import pkg from '../../package.json'
import { formatChangelogDate, parseChangelog } from './changelog'

describe('novedades (CHANGELOG.md)', () => {
  const entries = parseChangelog(changelog)

  it('la versión de la app tiene su entrada arriba del todo, con fecha y cambios', () => {
    // Si falla: al subir la versión en package.json, añade su entrada en CHANGELOG.md.
    expect(entries[0].version).toBe(pkg.version)
    expect(entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(entries[0].changes.length).toBeGreaterThan(0)
  })

  it('no repite versiones y van de la más nueva a la más antigua', () => {
    const versions = entries.map((entry) => entry.version)
    expect(new Set(versions).size).toBe(versions.length)
    const asNumber = (version: string) => version.split('.').reduce((total, part) => total * 1000 + Number(part), 0)
    expect(versions.map(asNumber)).toEqual([...versions.map(asNumber)].sort((a, b) => b - a))
  })

  it('lee encabezados y cambios', () => {
    expect(parseChangelog('# Novedades\nTexto\n## 1.2.3 — 2026-01-05\nPárrafo\n- Uno\n- Dos\n## 1.2.2\n- Tres')).toEqual([
      { version: '1.2.3', date: '2026-01-05', changes: ['Uno', 'Dos'] },
      { version: '1.2.2', date: '', changes: ['Tres'] },
    ])
    expect(formatChangelogDate('2026-11-22')).toBe('22/11/2026')
  })
})
