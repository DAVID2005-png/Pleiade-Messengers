export default function ConfirmDialog({ title, message, confirmLabel = 'Supprimer', onConfirm, onCancel }) {
  return <div className="modal-backdrop confirm-backdrop" onClick={onCancel}>
    <section className="modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={event => event.stopPropagation()}>
      <h2 id="confirm-title">{title}</h2>
      <p>{message}</p>
      <div className="confirm-actions">
        <button type="button" className="confirm-cancel" onClick={onCancel}>Annuler</button>
        <button type="button" className="confirm-submit" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </section>
  </div>
}
