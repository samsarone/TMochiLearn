"use client";

import { ArrowRight, Check, LoaderCircle, Send, X } from "lucide-react";
import { useState } from "react";
import { broadcastAuthEvent, clearAuthData } from "../../lib/client-auth";
import styles from "./creator.module.css";

type PublishResult = {
  publication_id?: string | null;
  publication?: { id?: string | null; publication_id?: string | null } | null;
  session?: { published_publication_id?: string | null } | null;
};

export default function PublishDialog({
  sessionId,
  suggestedTitle,
  onClose,
}: {
  sessionId: string;
  suggestedTitle: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(suggestedTitle.slice(0, 160));
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [publicationId, setPublicationId] = useState<string | null>(null);

  async function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setError("Add a title before publishing.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/creator/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, title: title.trim(), description: description.trim() }),
      });
      const result = await response.json().catch(() => null) as (PublishResult & { error?: string }) | null;
      if (response.status === 401) {
        clearAuthData();
        broadcastAuthEvent("logout");
        window.location.reload();
        return;
      }
      if (!response.ok) throw new Error(result?.error || "Unable to publish this film.");
      const resolvedId =
        result?.publication?.id ||
        result?.publication?.publication_id ||
        result?.publication_id ||
        result?.session?.published_publication_id ||
        null;
      setPublicationId(resolvedId);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Unable to publish this film.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !submitting) onClose();
    }}>
      <section className={styles.publishDialog} role="dialog" aria-modal="true" aria-labelledby="publish-title">
        <button className={styles.dialogClose} type="button" onClick={onClose} disabled={submitting} aria-label="Close publish dialog">
          <X size={18} />
        </button>

        {publicationId ? (
          <div className={styles.publishSuccess}>
            <span><Check size={24} /></span>
            <p className={styles.eyebrow}>Transmission live</p>
            <h2 id="publish-title">Your interactive film is published.</h2>
            <p>It now appears in the public tMochi feed and has its own shareable player.</p>
            <a className={styles.primaryButton} href={`/watch/${encodeURIComponent(publicationId)}`}>
              Watch published film <ArrowRight size={16} />
            </a>
          </div>
        ) : (
          <form onSubmit={publish}>
            <span className={styles.eyebrow}>Publish to tMochi</span>
            <h2 id="publish-title">Name this transmission.</h2>
            <p className={styles.dialogIntro}>Add the public details viewers will see in the feed.</p>
            {error && <div className={styles.formError} role="alert">{error}</div>}
            <label>
              <span>Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={160}
                placeholder="A memorable title"
                autoFocus
                required
              />
              <small>{title.length}/160</small>
            </label>
            <label>
              <span>Description</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                rows={5}
                placeholder="Tell viewers what they are about to explore…"
              />
              <small>{description.length}/2,000</small>
            </label>
            <div className={styles.dialogActions}>
              <button className={styles.secondaryButton} type="button" onClick={onClose} disabled={submitting}>Cancel</button>
              <button className={styles.primaryButton} type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle className={styles.spin} size={17} /> : <Send size={16} />}
                {submitting ? "Publishing" : "Publish film"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
