import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ErrorCard, Loading, PageHeader } from '../../components/ui'
import { createClientRecord, updateClient, type Client } from '../../lib/api'
import { formatPhone, normalizePhone } from '../../lib/phone'
import { useClient, useInvalidate } from '../../lib/queries'
import { Field } from './form-parts'

/** Add a client (no clientId) or edit one. */
export function ClientFormPage() {
  const { clientId } = useParams()
  const client = useClient(clientId ?? '')
  if (!clientId) return <ClientForm />
  if (client.isPending) return <section className="page"><PageHeader title="Edit client" back={`/clients/${clientId}`} /><Loading /></section>
  if (client.isError) return <section className="page"><ErrorCard error={client.error} /></section>
  return <ClientForm client={client.data} />
}

function ClientForm({ client }: { client?: Client }) {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const [name, setName] = useState(client?.name ?? '')
  const [phone, setPhone] = useState(client?.phone_override ? formatPhone(client.phone_override) : '')
  const [notes, setNotes] = useState(client?.notes ?? '')
  const [active, setActive] = useState(client?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const back = client ? `/clients/${client.id}` : '/clients'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const phoneDigits = phone.trim() ? normalizePhone(phone) : null
    if (phone.trim() && !phoneDigits) return setError('That phone number doesn’t look right. Include the country code for foreign numbers.')
    if (!name.trim()) return setError('Enter a name.')
    setSaving(true)
    setError(null)
    try {
      const changes = { name: name.trim(), phone_override: phoneDigits, notes: notes.trim() || null, active }
      if (client) {
        await updateClient(client.id, changes)
        await invalidate.client(client.id)
        navigate(back, { replace: true })
      } else {
        const created = await createClientRecord(changes)
        await invalidate.clients()
        navigate(`/clients/${created.id}`, { replace: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <section className="page">
      <PageHeader title={client ? 'Edit client' : 'Add client'} back={back} />
      <form className="card form" onSubmit={onSubmit} noValidate>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
        </Field>

        <Field
          label={client?.phone_contacts ? 'Phone fix' : 'Phone'}
          hint={
            client?.phone_contacts
              ? 'Leave empty to use the number from Contacts. A number here always wins over Contacts.'
              : 'Lebanese numbers can be typed without 961.'
          }
        >
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            placeholder={client?.phone_contacts ? formatPhone(client.phone_contacts) : '+961 …'}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>

        <Field label="Notes">
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {client && (
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Active client</span>
          </label>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="button primary block" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </section>
  )
}
