import React, { useState, useEffect, useCallback } from "react";

export interface ShareEntry {
  shareId: string;
  url: string;
  revision: number;
  createdAt: string;
  ownerToken?: string;
  expiresAt?: string;
  lastFeedbackAt?: string;
}

interface ShareDialogProps {
  sessionId: string;
  revision: number;
  open: boolean;
  shareEnabled: boolean;
  existingShares: ShareEntry[];
  onClose: () => void;
  onShareCreated: (share: ShareEntry) => void;
  onShareRevoked: (shareId: string) => void;
}

/**
 * Modal dialog for sharing a canvas revision to the cloud.
 *
 * Flow: user clicks Share → this dialog opens → user clicks "Create link"
 * → POST to daemon → daemon uploads snapshot to CF Worker → daemon returns
 * ShareEntry → dialog shows the URL with copy-to-clipboard.
 *
 * If a share already exists for this revision, the existing URL is shown
 * immediately. Owner can revoke (delete on the worker side) via the
 * stored ownerToken.
 */
export function ShareDialog({
  sessionId,
  revision,
  open,
  shareEnabled,
  existingShares,
  onClose,
  onShareCreated,
  onShareRevoked,
}: ShareDialogProps) {
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareForRev = existingShares.find((s) => s.revision === revision);

  useEffect(() => {
    if (!open) {
      setLoading(false);
      setRevoking(false);
      setError(null);
      setCopied(false);
    }
  }, [open]);

  const createShare = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/revision/${revision}/share`, {
        method: "POST",
      });
      const data = await res.json() as any;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onShareCreated(data.share as ShareEntry);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId, revision, onShareCreated]);

  const revoke = useCallback(async (shareId: string) => {
    if (!window.confirm("Revoke this share link? Reviewers will no longer be able to view or comment.")) return;
    setRevoking(true);
    setError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/shares/${shareId}/revoke`, {
        method: "POST",
      });
      const data = await res.json() as any;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onShareRevoked(shareId);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setRevoking(false);
    }
  }, [sessionId, onShareRevoked]);

  const copyUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-bg-surface border border-border-medium rounded-lg shadow-xl w-full max-w-md mx-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-text-primary font-body">
            Share this revision
          </h2>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated transition-colors"
          >
            <span className="text-xs">&#x2715;</span>
          </button>
        </div>

        {!shareEnabled ? (
          <div className="text-[13px] text-text-secondary font-body space-y-2">
            <p>Canvas sharing is not configured.</p>
            <p className="text-text-tertiary">
              Set <code className="px-1 py-0.5 rounded bg-bg-elevated text-text-primary text-[11px]">CANVAS_SHARE_ENDPOINT</code> to the URL of a deployed{" "}
              <code className="px-1 py-0.5 rounded bg-bg-elevated text-text-primary text-[11px]">canvas-share</code> worker and restart the daemon.
            </p>
          </div>
        ) : shareForRev ? (
          <div className="space-y-3">
            <p className="text-[13px] text-text-secondary font-body">
              This revision is shared:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={shareForRev.url}
                className="flex-1 px-2 py-1.5 text-[12px] font-mono bg-bg-input border border-border-medium rounded text-text-primary"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={() => copyUrl(shareForRev.url)}
                className="px-3 py-1.5 text-[12px] font-body font-medium rounded bg-accent-blue text-white hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            {shareForRev.expiresAt && (
              <p className="text-[11px] text-text-tertiary font-body">
                Expires {new Date(shareForRev.expiresAt).toLocaleDateString()}.
              </p>
            )}
            <p className="text-[11px] text-text-tertiary font-body">
              Anyone with this link can view and leave feedback. Reviewer
              feedback will appear in your annotation sidebar within seconds.
            </p>
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={createShare}
                disabled={loading || revoking}
                className="text-[11px] text-text-tertiary hover:text-text-secondary font-body underline disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create a new link"}
              </button>
              {shareForRev.ownerToken && (
                <button
                  onClick={() => revoke(shareForRev.shareId)}
                  disabled={loading || revoking}
                  className="text-[11px] text-accent-red hover:opacity-80 font-body underline disabled:opacity-50"
                >
                  {revoking ? "Revoking..." : "Revoke link"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-text-secondary font-body">
              Create a public link to this revision. Anyone with the link can
              view the canvas and leave feedback. Reviewer feedback will sync
              back here automatically.
            </p>
            <button
              onClick={createShare}
              disabled={loading}
              className="w-full px-3 py-2 text-[13px] font-body font-medium rounded bg-accent-blue text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? "Creating share link..." : "Create share link"}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-3 px-3 py-2 rounded bg-accent-red/10 border border-accent-red/20 text-[12px] text-accent-red font-body">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small share icon button for toolbar use. */
export function ShareButton({ onClick, title = "Share this revision", hasShare }: { onClick: () => void; title?: string; hasShare?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`group p-1.5 transition-colors ${hasShare ? "text-accent-blue hover:opacity-80" : "text-text-tertiary hover:text-text-secondary"}`}
      title={title}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3"/>
        <circle cx="6" cy="12" r="3"/>
        <circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
    </button>
  );
}
