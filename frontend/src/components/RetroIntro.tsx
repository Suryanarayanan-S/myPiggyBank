import { useEffect, useRef } from 'react';

/** 13×10 pixel piggy bank, drawn from a character map (P = pink, D = dark, E = eye, S = slot). */
const PIG = [
  '....SSS......',
  '..PPPPPPPP...',
  '.PPPPPPPPPP.D',
  'PPPPPPPPPEPPD',
  'PPPPPPPPPPPPP',
  'PPPPPPPPPPDDP',
  'PPPPPPPPPPPP.',
  '.PPPPPPPPPP..',
  '..PP....PP...',
  '..DD....DD...',
];
const COLOR: Record<string, string> = { P: '#ff77a8', D: '#7e2553', E: '#1d2b53', S: '#ffa300' };

function PixelPig({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={13 * size}
      height={10 * size}
      viewBox="0 0 13 10"
      shapeRendering="crispEdges"
      aria-hidden
    >
      {PIG.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === '.' ? null : (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={COLOR[c]} />
          ),
        ),
      )}
    </svg>
  );
}

function Coin({ delay, left }: { delay: number; left: string }) {
  return (
    <span
      className="pb-coin absolute top-0 block h-4 w-4"
      style={{ left, animationDelay: `${delay}s` }}
      aria-hidden
    >
      <svg viewBox="0 0 4 4" width="16" height="16" shapeRendering="crispEdges">
        <rect x="1" y="0" width="2" height="4" fill="#ffec27" />
        <rect x="0" y="1" width="4" height="2" fill="#ffec27" />
        <rect x="1.5" y="1" width="1" height="2" fill="#ffa300" />
      </svg>
    </span>
  );
}

/** The retro start screen: coins drop into the piggy bank; any key or click starts the app. */
export function RetroIntro({ onStart }: { onStart: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', ' ', 'Escape'].includes(e.key)) {
        e.preventDefault();
        onStart();
      }
    };
    const timer = window.setTimeout(onStart, 4000);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [onStart]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="myPiggyBank start screen"
      className="fixed inset-0 z-[60] flex cursor-pointer flex-col items-center justify-center gap-8 bg-[#1d2b53] px-4 text-center"
      onClick={onStart}
    >
      <div className="relative h-40 w-40">
        <Coin delay={0} left="45%" />
        <Coin delay={0.45} left="38%" />
        <Coin delay={0.9} left="52%" />
        <div className="pb-bounce absolute bottom-0 left-1/2 -translate-x-1/2">
          <PixelPig />
        </div>
      </div>
      <p
        className="font-pixel text-xl text-[#fff1e8] sm:text-2xl"
        style={{ fontFamily: "'Press Start 2P', monospace" }}
      >
        myPiggyBank
      </p>
      <button
        ref={button}
        type="button"
        onClick={(e) => (e.stopPropagation(), onStart())}
        className="pb-blink text-sm text-[#ffec27] focus:outline-none"
        style={{ fontFamily: "'Press Start 2P', monospace" }}
      >
        ▶ PRESS START ◀
      </button>
      <p
        className="text-xs text-[#c2c3c7]"
        style={{ fontFamily: "'VT323', monospace", fontSize: '1.1rem' }}
      >
        FAMILY EDITION · 1 PLAYER
      </p>
    </div>
  );
}
