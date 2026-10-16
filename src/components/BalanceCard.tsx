import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { ApprovalWithBalance, PackageWithBalance } from '../lib/api'
import { formatDate, formatMoney } from '../lib/format'
import { RemainingBadge, StatusBadge } from './ui'

type Props = {
  showClient?: boolean
  hideNotes?: boolean
  children?: ReactNode
} & ({ kind: 'package'; item: PackageWithBalance } | { kind: 'approval'; item: ApprovalWithBalance })

/** One package or approval: who, what, sessions left. Tapping opens the edit form. */
export function BalanceCard(props: Props) {
  const { kind, item, showClient, hideNotes, children } = props
  const total = kind === 'package' ? props.item.sessions_total : props.item.sessions_approved
  const editPath = kind === 'package' ? `/packages/${item.id}` : `/approvals/${item.id}`

  const title =
    kind === 'package'
      ? `Package of ${props.item.sessions_total} · ${formatMoney(props.item.price_total)}`
      : `${props.item.insurer}${props.item.serial_number ? ` · #${props.item.serial_number}` : ''}`

  const details: string[] = []
  if (kind === 'package') {
    if (props.item.purchased_on) details.push(`Bought ${formatDate(props.item.purchased_on)}`)
    details.push(`${formatMoney(props.item.per_session)} per session`)
  } else {
    details.push(`${formatMoney(props.item.billed_per_session)} billed, ${formatMoney(props.item.copay_per_session)} co-pay`)
    if (props.item.valid_until) details.push(`Valid until ${formatDate(props.item.valid_until)}`)
  }
  if (item.sessions_used_before_app > 0) {
    details.push(
      `${item.sessions_used_before_app} used before the app${item.used_before_app_as_of ? ` (to ${formatDate(item.used_before_app_as_of, { short: true })})` : ''}`,
    )
  }

  return (
    <article className="card balance-card">
      <Link to={editPath} className="balance-link">
        <div className="balance-top">
          <div>
            {showClient && item.client && <p className="strong">{item.client.name}</p>}
            <p className={showClient ? 'muted' : 'strong'}>{title}</p>
          </div>
          <div className="badges">
            {item.status === 'active' ? <RemainingBadge remaining={item.sessions_remaining} total={total} /> : <StatusBadge status={item.status} />}
          </div>
        </div>
        <p className="muted small">{details.join(' · ')}</p>
        {item.notes && !hideNotes && <p className="small note">{item.notes}</p>}
      </Link>
      {children && <div className="card-actions">{children}</div>}
    </article>
  )
}
