// SPDX-License-Identifier: BUSL-1.1
//
// Dialog primitive — Radix under the hood, semantic-token styled.
// Use for: NewAgentModal, InviteModal, ScheduleMeetingModal.
// For destructive confirmations use AlertDialog (Radix
// alert-dialog) — not yet wrapped here; add when needed.

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from "react";
import { forwardRef } from "react";

import { cn } from "../../lib/cn.js";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const Overlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-40 bg-navy/40 backdrop-blur-sm", className)}
    {...props}
    asChild
  >
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    />
  </DialogPrimitive.Overlay>
));
Overlay.displayName = "DialogOverlay";

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    showClose?: boolean;
  }
>(({ className, children, showClose = true, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <Overlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface-raised p-6 shadow-xl",
        className,
      )}
      {...props}
      asChild
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-4 top-4 rounded-md p-1 text-muted hover:bg-bg-warm hover:text-text"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </motion.div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return (
    <DialogPrimitive.Title className="text-base font-semibold text-text">
      {children}
    </DialogPrimitive.Title>
  );
}

export function DialogDescription({ children }: { children: ReactNode }) {
  return (
    <DialogPrimitive.Description className="mt-1 text-xs text-muted">
      {children}
    </DialogPrimitive.Description>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex items-center justify-end gap-2">{children}</div>;
}

// Re-export AnimatePresence so callers can wrap their open state.
export { AnimatePresence };
