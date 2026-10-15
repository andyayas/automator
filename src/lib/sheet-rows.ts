import type { WorkSheet } from 'xlsx'
import { utils } from 'xlsx'

/**
 * A sheet's cell values as rows, anchored at A1. sheet_to_json otherwise starts
 * at the first used cell, so a sheet whose first rows or columns are empty
 * would shift every "row 7" / "column D" rule.
 */
export function sheetRows(ws: WorkSheet | undefined): unknown[][] {
  if (!ws?.['!ref']) return []
  const range = utils.decode_range(ws['!ref'])
  range.s = { r: 0, c: 0 }
  return utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, raw: true, defval: null, range })
}
