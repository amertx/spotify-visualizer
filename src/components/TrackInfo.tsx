interface Props {
  name?: string | null;
  artist?: string | null;
  imageUrl?: string | null;
  emptyLabel?: string;
}

export function TrackInfo({
  name,
  artist,
  imageUrl,
  emptyLabel = 'Play something to begin',
}: Props) {
  if (!name) {
    return (
      <div className="track-info track-info--empty">
        <span className="track-idle">{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div className="track-info">
      {imageUrl && <img className="album-art" src={imageUrl} alt={name} />}
      <div className="track-text">
        <p className="track-name">{name}</p>
        {artist && <p className="track-artist">{artist}</p>}
      </div>
    </div>
  );
}
