export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="Vértice">
      <svg className="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M6 7.5 16 3l10 4.5v11L16 29 6 23.5v-16Z" stroke="currentColor" strokeWidth="1.4" />
        <path d="m6 7.5 10 5 10-5M16 12.5V29M10.8 20.8l5.2-8.3 5.4 4.8" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="16" cy="12.5" r="2.2" fill="currentColor" />
      </svg>
      {!compact && (
        <div className="brand-type">
          <strong>VÉRTICE</strong>
          <span>LOCAL AGENT OS</span>
        </div>
      )}
    </div>
  )
}
