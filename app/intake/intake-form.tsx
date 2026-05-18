'use client';

import { useCallback, useRef, useState, type CSSProperties, type DragEvent } from 'react';

import { submitIntakeUi, type IntakeUiError, type IntakeUiResult } from './actions';

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; data: IntakeUiResult }
  | { kind: 'error'; data: IntakeUiError };

export interface IntakeFormProps {
  triageInboxUrl: string;
  intakeProjectUrl: string;
}

export function IntakeForm({ triageInboxUrl, intakeProjectUrl }: IntakeFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [pickedFiles, setPickedFiles] = useState<File[]>([]);
  const [bodyValue, setBodyValue] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (status.kind === 'submitting') return;
    if (bodyValue.trim().length === 0 && pickedFiles.length === 0) {
      setStatus({
        kind: 'error',
        data: {
          ok: false,
          error: 'invalid_request',
          message: 'Type or paste something — or attach a file — to capture.'
        }
      });
      return;
    }

    const data = new FormData();
    data.set('body', bodyValue.trim().length === 0 ? '(attachment-only capture)' : bodyValue);
    for (const file of pickedFiles) data.append('attachment', file);

    setStatus({ kind: 'submitting' });
    const result = await submitIntakeUi(data);
    if (result.ok) {
      setStatus({ kind: 'success', data: result });
      setBodyValue('');
      setPickedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } else {
      setStatus({ kind: 'error', data: result });
    }
  }, [bodyValue, pickedFiles, status.kind]);

  const onDrop = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragOver(false);
    const dropped = event.dataTransfer?.files;
    if (!dropped || dropped.length === 0) return;
    setPickedFiles((prev) => [...prev, ...Array.from(dropped)]);
  }, []);

  const onFilesPicked = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPickedFiles((prev) => [...prev, ...Array.from(files)]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setPickedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <form
      ref={formRef}
      style={formStyle}
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      aria-busy={status.kind === 'submitting'}
    >
      <label htmlFor="intake-body" style={labelStyle}>
        Capture
      </label>
      <textarea
        id="intake-body"
        name="body"
        value={bodyValue}
        onChange={(e) => setBodyValue(e.target.value)}
        placeholder="Paste a forwarded email, jot an idea, drop a link — anything. We'll triage it."
        rows={8}
        style={textareaStyle}
        disabled={status.kind === 'submitting'}
        autoFocus
      />

      <label
        htmlFor="intake-files"
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          ...dropZoneStyle,
          borderColor: dragOver ? '#2563eb' : '#cbd5e1',
          background: dragOver ? '#eff6ff' : '#f8fafc'
        }}
      >
        <span style={{ fontWeight: 500 }}>Drop files here</span>
        <span style={{ color: '#475569', fontSize: 13 }}>
          or <u>browse</u> · max 10 MB each
        </span>
        <input
          id="intake-files"
          ref={fileInputRef}
          type="file"
          name="attachment"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => onFilesPicked(e.target.files)}
        />
      </label>

      {pickedFiles.length > 0 && (
        <ul style={fileListStyle}>
          {pickedFiles.map((f, i) => (
            <li key={`${f.name}-${i}`} style={fileItemStyle}>
              <span>
                <strong>{f.name}</strong>{' '}
                <span style={{ color: '#64748b' }}>
                  ({(f.size / 1024).toFixed(1)} KB · {f.type || 'unknown'})
                </span>
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                style={removeButtonStyle}
                aria-label={`Remove ${f.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={actionRowStyle}>
        <button type="submit" style={primaryButtonStyle} disabled={status.kind === 'submitting'}>
          {status.kind === 'submitting' ? 'Capturing…' : 'Capture'}
        </button>
        <span style={{ color: '#64748b', fontSize: 13 }}>
          Ctrl+Enter to submit · drafts land in{' '}
          <a href={intakeProjectUrl} style={linkStyle}>
            Intake
          </a>
        </span>
      </div>

      {status.kind === 'success' && (
        <div style={successStyle} role="status">
          <p style={{ margin: 0, fontWeight: 500 }}>
            Draft created:{' '}
            <a href={status.data.draftUrl} style={successLinkStyle}>
              {status.data.identifier}
            </a>
          </p>
          <p style={successSubStyle}>
            <strong>{status.data.title}</strong>
            {!status.data.draftCreated ? ' — existing draft (idempotent match)' : ''}
          </p>
          <p style={successSubStyle}>
            <a href={triageInboxUrl} style={successLinkStyle}>
              Open Triage Inbox →
            </a>
          </p>
        </div>
      )}

      {status.kind === 'error' && (
        <div style={errorStyle} role="alert">
          <p style={{ margin: 0, fontWeight: 500 }}>Capture failed</p>
          <p style={errorSubStyle}>{status.data.message}</p>
        </div>
      )}
    </form>
  );
}

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12
};

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: '#334155'
};

const textareaStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 15,
  lineHeight: '22px',
  color: '#0f172a',
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  padding: '12px 14px',
  resize: 'vertical',
  minHeight: 160,
  boxShadow: 'inset 0 1px 0 rgba(15,23,42,0.04)'
};

const dropZoneStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  border: '1px dashed',
  borderRadius: 8,
  padding: '18px 14px',
  cursor: 'pointer',
  transition: 'background 120ms ease, border-color 120ms ease'
};

const fileListStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6
};

const fileItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  background: '#f1f5f9',
  borderRadius: 6,
  fontSize: 13
};

const removeButtonStyle: CSSProperties = {
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#334155',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer'
};

const actionRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap'
};

const primaryButtonStyle: CSSProperties = {
  background: '#0f172a',
  color: '#f8fafc',
  border: 'none',
  padding: '10px 20px',
  fontSize: 14,
  fontWeight: 500,
  borderRadius: 8,
  cursor: 'pointer'
};

const successStyle: CSSProperties = {
  background: '#ecfdf5',
  border: '1px solid #6ee7b7',
  borderRadius: 8,
  padding: '12px 14px'
};

const successSubStyle: CSSProperties = {
  margin: '6px 0 0 0',
  fontSize: 13,
  color: '#065f46'
};

const successLinkStyle: CSSProperties = {
  color: '#047857',
  fontWeight: 500
};

const errorStyle: CSSProperties = {
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 8,
  padding: '12px 14px'
};

const errorSubStyle: CSSProperties = {
  margin: '6px 0 0 0',
  fontSize: 13,
  color: '#991b1b'
};

const linkStyle: CSSProperties = {
  color: '#2563eb'
};
