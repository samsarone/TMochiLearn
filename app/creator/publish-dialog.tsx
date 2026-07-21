"use client";

import { ArrowRight, Check, LoaderCircle, Send, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";
import { broadcastAuthEvent, clearAuthData } from "../../lib/client-auth";
import styles from "./creator.module.css";

type PublishResult = {
  publication_id?: string | null;
  publication?: { id?: string | null; publication_id?: string | null } | null;
  session?: { published_publication_id?: string | null } | null;
};

type GenerateMetaResult = {
  title?: string | null;
  description?: string | null;
  creditsRemaining?: number;
  remainingCredits?: number;
  code?: string;
  error?: string;
};

const RETRYABLE_META_REQUEST_CODES = new Set([
  "PUBLICATION_METADATA_IN_PROGRESS",
  "PUBLICATION_METADATA_BILLING_IN_PROGRESS",
  "PUBLICATION_METADATA_WORKER_LEASE_LOST",
]);

const parseTaxonomyList = (value: string, limit: number) =>
  Array.from(new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )).slice(0, limit);

function createClientRequestId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function PublishDialog({
  sessionId,
  suggestedTitle,
  onClose,
  onCreditsRemaining,
  onInsufficientCredits,
}: {
  sessionId: string;
  suggestedTitle: string;
  onClose: () => void;
  onCreditsRemaining?: (credits: number) => void;
  onInsufficientCredits: () => void;
}) {
  const [title, setTitle] = useState(suggestedTitle.slice(0, 160));
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState("");
  const [topics, setTopics] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generatingMeta, setGeneratingMeta] = useState(false);
  const [publicationId, setPublicationId] = useState<string | null>(null);
  const metaRequestIdRef = useRef<string | null>(null);
  const busy = submitting || generatingMeta;

  function returnToSignIn() {
    clearAuthData();
    broadcastAuthEvent("logout");
    window.location.reload();
  }

  async function generateMeta() {
    const clientRequestId = metaRequestIdRef.current || createClientRequestId();
    metaRequestIdRef.current = clientRequestId;
    setGeneratingMeta(true);
    setError(null);

    try {
      const response = await fetch("/api/creator/generate-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, client_request_id: clientRequestId }),
      });
      const result = await response.json().catch(() => null) as GenerateMetaResult | null;
      if (response.status === 401) {
        returnToSignIn();
        return;
      }
      const creditsRemaining = result?.creditsRemaining ?? result?.remainingCredits;
      if (Number.isFinite(Number(creditsRemaining))) {
        onCreditsRemaining?.(Math.max(0, Number(creditsRemaining)));
      }
      if (response.status === 402) {
        metaRequestIdRef.current = null;
        onInsufficientCredits();
        return;
      }
      if (!response.ok) {
        if (result?.code && !RETRYABLE_META_REQUEST_CODES.has(result.code)) {
          metaRequestIdRef.current = null;
        }
        throw new Error(result?.error || "Unable to generate publication metadata.");
      }

      const generatedTitle = typeof result?.title === "string" ? result.title.trim() : "";
      const generatedDescription = typeof result?.description === "string"
        ? result.description.trim()
        : "";
      if (!generatedTitle || !generatedDescription) {
        metaRequestIdRef.current = null;
        throw new Error("Samsar did not return complete publication metadata.");
      }

      setTitle(generatedTitle.slice(0, 160));
      setDescription(generatedDescription.slice(0, 2000));
      metaRequestIdRef.current = null;
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Unable to generate publication metadata.",
      );
    } finally {
      setGeneratingMeta(false);
    }
  }

  async function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (generatingMeta) return;
    if (!title.trim()) {
      setError("Add a title before publishing.");
      return;
    }
    const categoryList = parseTaxonomyList(categories, 3);
    const topicList = parseTaxonomyList(topics, 8);
    if (categoryList.length === 0 || topicList.length === 0) {
      setError("Add at least one category and one topic before publishing.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/creator/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          title: title.trim(),
          description: description.trim(),
          categories: categoryList,
          topics: topicList,
        }),
      });
      const result = await response.json().catch(() => null) as (PublishResult & { error?: string }) | null;
      if (response.status === 401) {
        returnToSignIn();
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
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <section className={styles.publishDialog} role="dialog" aria-modal="true" aria-labelledby="publish-title">
        <button className={styles.dialogClose} type="button" onClick={onClose} disabled={busy} aria-label="Close publish dialog">
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
            <div className={styles.dialogHeading}>
              <div>
                <span className={styles.eyebrow}>Publish to tMochi</span>
                <h2 id="publish-title">Name this transmission.</h2>
                <p className={styles.dialogIntro}>Add the public details viewers will see in the feed.</p>
              </div>
              <button
                className={`${styles.secondaryButton} ${styles.generateMetaButton}`}
                type="button"
                onClick={() => void generateMeta()}
                disabled={busy}
              >
                {generatingMeta
                  ? <LoaderCircle className={styles.spin} size={15} />
                  : <Sparkles size={15} />}
                {generatingMeta ? "Generating" : "Generate meta"}
              </button>
            </div>
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
                disabled={busy}
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
                disabled={busy}
              />
              <small>{description.length}/2,000</small>
            </label>
            <div className={styles.taxonomyFields}>
              <label>
                <span>Categories</span>
                <input
                  value={categories}
                  onChange={(event) => setCategories(event.target.value)}
                  maxLength={160}
                  placeholder="Education, Science & Technology"
                  disabled={busy}
                  required
                />
                <small>Up to 3, comma separated</small>
              </label>
              <label>
                <span>Topics</span>
                <input
                  value={topics}
                  onChange={(event) => setTopics(event.target.value)}
                  maxLength={320}
                  placeholder="cell biology, ecosystems"
                  disabled={busy}
                  required
                />
                <small>Up to 8, comma separated</small>
              </label>
            </div>
            <div className={styles.dialogActions}>
              <button className={styles.secondaryButton} type="button" onClick={onClose} disabled={busy}>Cancel</button>
              <button className={styles.primaryButton} type="submit" disabled={busy}>
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
