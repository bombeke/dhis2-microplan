import React, { useRef, useState } from 'react';

/** Drag-or-click CSV/Excel upload. Parsing happens in the parent. */
export const UploadPanel: React.FC<{ onUpload: (f: File) => Promise<void> }> = ({
  onUpload,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);

  const handle = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setName(file.name);
    try {
      await onUpload(file);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="upload"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        handle(e.dataTransfer.files[0]);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.xlsx,.xls"
        hidden
        onChange={(e) => handle(e.target.files?.[0])}
      />
      <strong>{busy ? 'Processing…' : 'Upload microplan'}</strong>
      <span>{name ?? 'CSV or Excel — settlement, team code, ward, weeks 1–4'}</span>
    </div>
  );
};
