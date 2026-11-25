"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MiniBars } from "@/components/ui/tile";
import { prefersReducedMotion } from "@/components/ui/motion";
import type { Insight } from "@/lib/overview";

const TONE_COLOR: Record<Insight["tone"], string> = {
  accent: "var(--accent)",
  sleep: "var(--sleep)",
  heart: "var(--heart)",
};

/** Past this distance, or this speed (px per ms), a released card leaves the deck. */
const DISMISS_PX = 100;
const DISMISS_SPEED = 0.11;
const LEAVE_MS = 240;

function restingTransform(depth: number) {
  return `translateY(${depth * 12}px) scale(${1 - depth * 0.045})`;
}

/**
 * The observations of the summary as a deck: one card at a time, the next ones peeking
 * out below. A card can be thrown aside with the mouse or a finger (a short flick is
 * enough) or with the "Ďalší postreh" button; it then goes to the back of the deck.
 */
export function InsightDeck({ insights }: { insights: Insight[] }) {
  const [order, setOrder] = useState(() => insights.map((_, index) => index));
  const [leaving, setLeaving] = useState<{ index: number; dir: number } | null>(null);
  const cards = useRef(new Map<number, HTMLElement>());
  const drag = useRef<{ index: number; x0: number; t0: number; dx: number; id: number; moved: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new set of insights (another day) starts the deck over.
  const signature = insights.map((insight) => insight.key + insight.text).join("|");
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setOrder(insights.map((_, index) => index));
    setLeaving(null);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const dismiss = (dir: number) => {
    if (leaving || order.length < 2) return;
    const top = order[0];
    const instant = prefersReducedMotion();
    setLeaving({ index: top, dir });
    timer.current = setTimeout(() => {
      // The thrown card jumps straight to the back of the deck instead of flying back.
      const element = cards.current.get(top);
      if (element) element.style.transition = "none";
      setOrder((current) => [...current.slice(1), current[0]]);
      setLeaving(null);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (element) element.style.transition = "";
        }),
      );
    }, instant ? 0 : LEAVE_MS);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLElement>, index: number) => {
    if (index !== order[0] || leaving || order.length < 2 || event.button !== 0) return;
    drag.current = { index, x0: event.clientX, t0: event.timeStamp, dx: 0, id: event.pointerId, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.id) return;
    state.dx = event.clientX - state.x0;
    const element = cards.current.get(state.index);
    if (!element) return;
    if (!state.moved && Math.abs(state.dx) > 6) {
      state.moved = true;
      element.setPointerCapture(event.pointerId);
      element.dataset.dragging = "true";
    }
    // Follow the pointer 1:1, straight on the element: no React render per frame.
    if (state.moved) element.style.transform = `translateX(${state.dx}px) rotate(${state.dx / 40}deg)`;
  };
  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.id) return;
    drag.current = null;
    const element = cards.current.get(state.index);
    if (!element || !state.moved) return;
    element.dataset.dragging = "false";
    const speed = Math.abs(state.dx) / Math.max(1, event.timeStamp - state.t0);
    if (Math.abs(state.dx) > DISMISS_PX || (speed > DISMISS_SPEED && Math.abs(state.dx) > 12)) {
      element.style.transform = "";
      dismiss(Math.sign(state.dx) || -1);
    } else {
      element.style.transform = restingTransform(0);
    }
    // The click that ends a drag must not open the card's link.
    element.dataset.justDragged = "true";
    setTimeout(() => {
      element.dataset.justDragged = "false";
    }, 0);
  };

  if (insights.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-[2.4_1_480px] flex-col gap-3">
      <div className="relative" style={{ height: 210 + Math.min(order.length - 1, 2) * 12 }}>
        {order.map((index, depth) => {
          const insight = insights[index];
          const isLeaving = leaving?.index === index;
          const transform = isLeaving
            ? `translateX(${leaving.dir * 115}%) rotate(${leaving.dir * 6}deg)`
            : restingTransform(depth);
          const hidden = depth > 2;
          return (
            <Link
              key={insight.key}
              ref={(element) => {
                if (element) cards.current.set(index, element);
                else cards.current.delete(index);
              }}
              href={insight.href}
              draggable={false}
              aria-hidden={depth === 0 ? undefined : true}
              tabIndex={depth === 0 ? undefined : -1}
              onClickCapture={(event) => {
                if (event.currentTarget.dataset.justDragged === "true") event.preventDefault();
              }}
              onPointerDown={(event) => onPointerDown(event, index)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="deck-card absolute inset-x-0 top-0 flex h-[210px] flex-col gap-3 rounded-[22px] border border-line p-5 no-underline"
              style={{
                zIndex: isLeaving ? 20 : 10 - depth,
                transform,
                opacity: isLeaving || hidden ? 0 : 1 - depth * 0.2,
                background: "var(--surface)",
                cursor: order.length > 1 ? "grab" : undefined,
              }}
            >
              <MiniBars
                values={insight.bars.map((bar) => bar.value)}
                highlight={insight.bars.flatMap((bar, barIndex) => (bar.highlight ? [barIndex] : []))}
                color={TONE_COLOR[insight.tone]}
                height={44}
              />
              <span className="text-[17px] leading-[1.3] font-medium tracking-[-0.01em]">{insight.text}</span>
              <span className="mt-auto text-[12px] text-muted">{insight.detail}</span>
            </Link>
          );
        })}
      </div>
      {order.length > 1 && (
        <div className="flex items-center justify-between gap-3">
          <span className="mono text-[11px] text-muted" aria-live="polite">
            {order[0] + 1} / {insights.length}
          </span>
          <button type="button" className="pill pill-outline" onClick={() => dismiss(-1)}>
            Ďalší postreh
          </button>
        </div>
      )}
    </div>
  );
}
