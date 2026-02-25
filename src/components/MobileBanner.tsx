import { useState } from 'react';

const DISMISSED_KEY = 'mobile-banner-dismissed';

interface Props {
  onDismiss: () => void;
}

export function MobileBanner({ onDismiss }: Props) {
  const [visible, setVisible] = useState(() => !sessionStorage.getItem(DISMISSED_KEY));

  if (!visible) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
    onDismiss();
  }

  return (
    <div className="mobile-banner" role="alert" aria-live="polite">
      <span className="mobile-banner-text">
        For the best experience, visit on desktop. Mobile mode uses preview audio for visuals.
      </span>
      <button className="mobile-banner-dismiss" onClick={dismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
