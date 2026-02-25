import { useRef, useState } from 'react';
import { useSearch } from '../hooks/useSearch';
import type { SpotifyTrack } from '../spotify/types';

interface Props {
  onSelect: (track: SpotifyTrack) => void;
  disabled?: boolean;
}

export function SearchBar({ onSelect, disabled }: Props) {
  const { query, results, loading, search, clear } = useSearch();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const showDropdown = open && (loading || results.length > 0);

  function handleSelect(track: SpotifyTrack) {
    onSelect(track);
    clear();
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div className="search-wrap">
      <div className={`search-bar ${open ? 'search-bar--open' : ''}`}>
        <svg className="search-icon" viewBox="0 0 20 20" fill="none">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Search tracks, artists, albums…"
          value={query}
          disabled={disabled}
          onChange={(e) => search(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
        />
        {query && (
          <button className="search-clear" onMouseDown={(e) => e.preventDefault()} onClick={clear}>
            ✕
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="search-results">
          {loading && (
            <div className="search-loading">
              <div className="spinner" />
            </div>
          )}
          {results.map((track) => {
            const thumb = track.album.images[track.album.images.length - 1]?.url;
            const artists = track.artists.map((a) => a.name).join(', ');
            return (
              <button
                key={track.id}
                className="result-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(track)}
              >
                <div className="result-art-wrap">
                  {thumb ? (
                    <img className="result-art" src={thumb} alt={track.album.name} />
                  ) : (
                    <div className="result-art result-art--placeholder">♪</div>
                  )}
                </div>
                <div className="result-text">
                  <p className="result-name">{track.name}</p>
                  <p className="result-artist">{artists}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
