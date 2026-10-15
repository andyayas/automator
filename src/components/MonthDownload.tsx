import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { downloadFile, downloadTemplate, fetchMonth } from '../lib/day-api'
import { formatDate, plural, todayISO } from '../lib/format'
import { monthReportDays } from '../lib/month-report'
import { useApprovals, usePackages } from '../lib/queries'

/** One Excel file for the month: a tab per confirmed day, like her old monthly workbooks. */
export function MonthDownload({ date }: { date: string }) {
  const month = date.slice(0, 7)
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const data = useQuery({ queryKey: ['day-review', 'month', month], queryFn: () => fetchMonth(month, todayISO()) })
  const packages = usePackages()
  const approvals = useApprovals()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    if (!data.data) return
    setBusy(true)
    setError(null)
    try {
      const days = monthReportDays({ ...data.data, packages: packages.data ?? [], approvals: approvals.data ?? [] })
      const [{ buildMonthReport }, template] = await Promise.all([import('../lib/report'), downloadTemplate()])
      downloadFile(await buildMonthReport(template, days), `Daily Report ${monthName}.xlsx`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const confirmed = data.data?.confirmedDates.length ?? 0
  const missing = data.data?.notConfirmed ?? []
  return (
    <div className="card month-download">
      <p className="strong">{monthName} in one file</p>
      <p className="muted small">
        {data.isPending ? 'Checking…' : `${plural(confirmed, 'confirmed day')}, one tab each.`}
        {missing.length > 0 && ' Not confirmed yet (left out): '}
        {missing.map((d, i) => (
          <span key={d}>
            {i ? ', ' : ''}
            <Link to={`/day/${d}`}>{formatDate(d, { short: true })}</Link>
          </span>
        ))}
      </p>
      {error && <p className="error small">{error}</p>}
      <button type="button" className="button block" disabled={busy || !confirmed} onClick={download}>
        {busy ? 'Building the file…' : `Download ${monthName.split(' ')[0]}`}
      </button>
    </div>
  )
}
