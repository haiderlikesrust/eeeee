import { useState } from 'react';
import './FormattingToolbar.css';

const FORMATS = [
  { label: 'B', title: 'Bold', prefix: '**', suffix: '**', cls: 'fmt-bold' },
  { label: 'I', title: 'Italic', prefix: '*', suffix: '*', cls: 'fmt-italic' },
  { label: 'S', title: 'Strikethrough', prefix: '~~', suffix: '~~', cls: 'fmt-strike' },
  { label: '</>', title: 'Code', prefix: '`', suffix: '`', cls: 'fmt-code' },
  { label: '||', title: 'Spoiler', prefix: '||', suffix: '||', cls: 'fmt-spoiler' },
];

export default function FormattingToolbar({ inputRef, value, onChange }) {
  const [expanded, setExpanded] = useState(true);

  const applyFormat = (format) => {
    const el = inputRef?.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const before = value.slice(0, start);
    const after = value.slice(end);
    const newText = `${before}${format.prefix}${selected || 'text'}${format.suffix}${after}`;
    onChange(newText);
    // Restore cursor position after the formatted text
    requestAnimationFrame(() => {
      el.focus();
      const cursorPos = start + format.prefix.length + (selected || 'text').length;
      el.setSelectionRange(cursorPos, cursorPos);
    });
  };

  return (
    <div className={`formatting-toolbar ${expanded ? '' : 'formatting-toolbar--collapsed'}`}>
      {expanded && (
        <>
          {FORMATS.map((f) => (
            <button
              key={f.label}
              type="button"
              className={`fmt-btn ${f.cls}`}
              title={f.title}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent input blur
                applyFormat(f);
              }}
            >
              {f.label}
            </button>
          ))}
        </>
      )}
      <button
        type="button"
        className="formatting-toolbar-toggle"
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? 'Hide formatting bar' : 'Show formatting bar'}
        aria-label={expanded ? 'Hide formatting bar' : 'Show formatting bar'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" className={expanded ? '' : 'formatting-toolbar-toggle--collapsed'}>
          <path fill="currentColor" d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
        </svg>
      </button>
    </div>
  );
}
