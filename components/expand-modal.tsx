"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { sound } from "@/lib/sound";

/**
 * Magnify-on-touch overlay. A block's expand button opens this — the panel
 * scales up out of the surface with a blurred scrim, holding richer controls.
 */
export function ExpandModal({
  open,
  onClose,
  title,
  tag,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  tag?: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    sound.tick();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  // Portal to body so a CSS-transformed ancestor can't trap the fixed scrim.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="xm-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="xm-panel"
            initial={{ opacity: 0, scale: 0.92, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="xm-head">
              <span className="xm-title">{title}</span>
              {tag && <span className="xm-tag">{tag}</span>}
              <button className="xm-x" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
            </div>
            <div className="xm-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
