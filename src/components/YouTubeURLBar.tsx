import { useState } from 'react';

interface Props {
  onLoad: (url: string) => void;
  loading?: boolean;
  error?: string | null;
}

export function YouTubeURLBar({ onLoad, loading, error }: Props) {
  const [value, setValue] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (v) onLoad(v);
  }

  return (
    <div className="search-wrap">
      <form className="search-bar" onSubmit={handleSubmit}>
        {/* YouTube icon */}
        <svg className="search-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="4" width="16" height="12" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8.5 7.5l4 2.5-4 2.5V7.5z" fill="currentColor" />
        </svg>
        <input
          className="search-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Paste a YouTube link…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={loading}
        />
        {value && (
          <button type="submit" className="yt-load-btn" disabled={loading}>
            {loading ? <span className="btn-spinner" /> : '↵'}
          </button>
        )}
      </form>
      {error && !loading && <div className="search-error">{error}</div>}
    </div>
  );
}
