/**
 * Opens a dialog with focus where it helps: a search box marked
 * data-autofocus, else the dialog itself. Not its first button: Safari would
 * draw a focus ring around "Close" every time it opens. Give the dialog
 * tabIndex={-1}.
 */
export function openDialog(d: HTMLDialogElement | null) {
  if (!d || d.open) return
  d.showModal()
  const target = d.querySelector<HTMLElement>('[data-autofocus]') ?? d
  target.focus()
}
