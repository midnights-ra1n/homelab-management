"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Adapté du portfolio : la navbar se masque dès qu'on défile (souris) ou en
// descendant (tactile), et réapparaît en haut de page, en remontant au doigt,
// ou quand la souris approche du haut de l'écran.
const THRESHOLD_DESKTOP = 8;
const THRESHOLD_MOBILE = 40;
const HOVER_ZONE_HEIGHT = 60;
const KEEP_ZONE_HEIGHT = 140;
const HIDE_DELAY = 450;

const isTouchDevice = () => window.matchMedia("(pointer: coarse)").matches;

export function useScrollVisibility() {
  const [visible, setVisible] = useState(true);
  const lastScrollY = useRef(0);
  const accumulated = useRef(0);
  const isHovering = useRef(false);
  const scrollWantsVisible = useRef(true);
  const leaveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onScroll = () => {
      const current = window.scrollY;
      const delta = current - lastScrollY.current;
      lastScrollY.current = current;

      if (current < 10) {
        accumulated.current = 0;
        scrollWantsVisible.current = true;
        setVisible(true);
        return;
      }

      if (isTouchDevice()) {
        if ((delta > 0 && accumulated.current < 0) || (delta < 0 && accumulated.current > 0)) accumulated.current = 0;
        accumulated.current += delta;
        if (Math.abs(accumulated.current) < THRESHOLD_MOBILE) return;
        const up = accumulated.current < 0;
        accumulated.current = 0;
        scrollWantsVisible.current = up;
        setVisible(up);
        return;
      }

      accumulated.current += Math.abs(delta);
      if (accumulated.current < THRESHOLD_DESKTOP) return;
      accumulated.current = 0;
      scrollWantsVisible.current = false;
      if (!isHovering.current) setVisible(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const cancelLeave = useCallback(() => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = undefined;
  }, []);

  const scheduleLeave = useCallback(() => {
    if (leaveTimer.current !== undefined) return;
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = undefined;
      isHovering.current = false;
      setVisible(scrollWantsVisible.current);
    }, HIDE_DELAY);
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isTouchDevice()) return;
      if (e.clientY <= HOVER_ZONE_HEIGHT) {
        cancelLeave();
        if (!isHovering.current) {
          isHovering.current = true;
          setVisible(true);
        }
      } else if (isHovering.current) {
        if (e.clientY <= KEEP_ZONE_HEIGHT) cancelLeave();
        else scheduleLeave();
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      cancelLeave();
    };
  }, [cancelLeave, scheduleLeave]);

  const forceShow = useCallback(() => {
    if (isTouchDevice()) return;
    cancelLeave();
    isHovering.current = true;
    setVisible(true);
  }, [cancelLeave]);

  const forceHide = useCallback(() => {
    if (isTouchDevice()) return;
    scheduleLeave();
  }, [scheduleLeave]);

  return { visible, forceShow, forceHide };
}
