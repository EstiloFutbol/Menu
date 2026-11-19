import { describe, expect, it } from 'vitest'
import { backupFileName, buildBackup, countRows, EXPORT_TABLES, EXPORT_VERSION } from './export'

describe('buildBackup', () => {
  const now = new Date('2026-11-19T10:00:00Z')

  it('incluye versión, fecha y todas las tablas, rellenando las ausentes', () => {
    const backup = buildBackup({ recipes: [{ id: '1' }] }, now)
    expect(backup.version).toBe(EXPORT_VERSION)
    expect(backup.exportedAt).toBe('2026-11-19T10:00:00.000Z')
    expect(Object.keys(backup.tables)).toEqual([...EXPORT_TABLES])
    expect(backup.tables.recipes).toEqual([{ id: '1' }])
    expect(backup.tables.ingredients).toEqual([])
  })

  it('conserva tablas extra y es serializable', () => {
    const backup = buildBackup({ otra: [{ id: 'x' }] }, now)
    expect(backup.tables.otra).toEqual([{ id: 'x' }])
    expect(JSON.parse(JSON.stringify(backup))).toEqual(backup)
  })
})

describe('backupFileName', () => {
  it('usa el formato menu-copia-AAAA-MM-DD.json', () => {
    expect(backupFileName(new Date(2026, 0, 5))).toBe('menu-copia-2026-01-05.json')
  })
})

describe('countRows', () => {
  it('cuenta las filas por tabla', () => {
    expect(countRows({ a: [{}, {}], b: [] })).toEqual({ a: 2, b: 0 })
  })
})
