export const EXPORT_VERSION = 1

export const EXPORT_TABLES = [
  'ingredients', 'recipes', 'recipe_ingredients', 'recipe_steps',
  'menu_entries', 'menu_entry_recipes', 'menu_entry_products',
  'pantry_items', 'shopping_lists', 'shopping_items',
  'purchases', 'purchase_items',
  'consumption_logs', 'consumption_ingredients',
  'receipt_aliases', 'user_settings', 'household_settings',
  'menu_day_notes', 'quick_list_items',
] as const

export type ExportRow = Record<string, unknown>
export type ExportTables = Record<string, ExportRow[]>

export interface BackupFile {
  version: number
  exportedAt: string
  tables: ExportTables
}

export function buildBackup(tables: ExportTables, now: Date = new Date()): BackupFile {
  const ordered: ExportTables = {}
  for (const name of EXPORT_TABLES) ordered[name] = tables[name] ?? []
  for (const name of Object.keys(tables)) if (!(name in ordered)) ordered[name] = tables[name]
  return { version: EXPORT_VERSION, exportedAt: now.toISOString(), tables: ordered }
}

export function backupFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `menu-copia-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`
}

export function countRows(tables: ExportTables): Record<string, number> {
  return Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]))
}
