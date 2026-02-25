import type { SpotifyTrack } from '../spotify/types';

interface Props {
  track: SpotifyTrack | null;
}

export function TrackInfo({ track }: Props) {
  if (!track) {
    return (
      <div className="track-info track-info--empty">
        <span className="track-idle">Play something on Spotify to begin</span>
      </div>
    );
  }

  const albumArt = track.album.images[0]?.url;
  const artists = track.artists.map((a) => a.name).join(', ');

  return (
    <div className="track-info">
      {albumArt && <img className="album-art" src={albumArt} alt={track.album.name} />}
      <div className="track-text">
        <p className="track-name">{track.name}</p>
        <p className="track-artist">{artists}</p>
      </div>
    </div>
  );
}
