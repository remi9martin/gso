export function CanvasErrorState({ headline, body }: { headline: string; body: string }) {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '4rem',
        maxWidth: '40rem',
        color: '#1f1f1f'
      }}
    >
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Org Canvas</h1>
      <div
        style={{
          marginTop: '1.5rem',
          padding: '1rem 1.25rem',
          border: '1px solid #f0c674',
          background: '#fff8e1',
          borderRadius: 8
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{headline}</div>
        <div style={{ fontSize: '0.95rem', color: '#5a4a16' }}>{body}</div>
      </div>
    </main>
  );
}
