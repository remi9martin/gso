export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem', maxWidth: '40rem' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>GSO</h1>
      <p style={{ color: '#555' }}>
        Operating layer for solo AI founders. The product surface lives behind this page — Org
        Canvas, Triage Inbox, and Budget &amp; Governance.
      </p>
      <p style={{ marginTop: '2rem' }}>
        Health: <a href="/api/healthz">/api/healthz</a>
      </p>
    </main>
  );
}
