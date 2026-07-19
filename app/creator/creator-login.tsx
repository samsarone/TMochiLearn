"use client";

import { ArrowLeft, ArrowRight, KeyRound, LoaderCircle, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  broadcastAuthEvent,
  clearAuthData,
  getAuthCookieToken,
  getExistingAuthToken,
  persistAuthToken,
} from "../../lib/client-auth";
import { CreatorBrand } from "./creator-brand";
import styles from "./creator.module.css";

type AuthView = "login" | "register";

function buildUsernameFromEmail(email: string) {
  const localPart = email.split("@")[0] || "user";
  const normalized = localPart
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return normalized || `user_${Date.now().toString(36)}`;
}

export default function CreatorLogin({ redirectPath = "/creator" }: { redirectPath?: string }) {
  const [view, setView] = useState<AuthView>("login");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [restoringSession, setRestoringSession] = useState(false);

  const safeRedirect = redirectPath.startsWith("/creator") && !redirectPath.startsWith("//")
    ? redirectPath
    : "/creator";

  useEffect(() => {
    const controller = new AbortController();
    const candidates = Array.from(new Set([
      getExistingAuthToken(),
      getAuthCookieToken(),
    ].filter((token): token is string => Boolean(token))));

    if (!candidates.length) {
      return () => controller.abort();
    }

    const restore = async () => {
      setRestoringSession(true);
      for (const token of candidates) {
        try {
          const response = await fetch("/api/auth/session", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: controller.signal,
          });
          if (response.ok) {
            persistAuthToken(token);
            broadcastAuthEvent("oauth_complete");
            window.location.replace(safeRedirect);
            return;
          }
          if (response.status !== 401) break;
        } catch (restoreError) {
          if (restoreError instanceof DOMException && restoreError.name === "AbortError") return;
          break;
        }
      }

      if (!controller.signal.aborted) {
        clearAuthData();
        setRestoringSession(false);
      }
    };

    const timer = window.setTimeout(() => void restore(), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [safeRedirect]);

  async function submitAuthentication(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const endpoint = view === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = view === "login"
        ? { email, password }
        : {
            email,
            password,
            username: buildUsernameFromEmail(email),
            preferredLanguage: navigator.language?.split("-")[0] || "en",
            subscribeToWeeklyNewsletter: false,
          };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null) as {
        authToken?: string;
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          result?.error || (view === "login" ? "Unable to sign in." : "Unable to create your account."),
        );
      }
      if (!result?.authToken || !persistAuthToken(result.authToken)) {
        throw new Error("Samsar did not return a valid authentication token.");
      }
      broadcastAuthEvent("oauth_complete");
      window.location.replace(safeRedirect);
    } catch (authenticationError) {
      setError(
        authenticationError instanceof Error
          ? authenticationError.message
          : view === "login"
            ? "Unable to sign in."
            : "Unable to create your account.",
      );
      setSubmitting(false);
    }
  }

  function changeView(nextView: AuthView) {
    if (submitting || nextView === view) return;
    setView(nextView);
    setError(null);
  }

  return (
    <main className={styles.loginShell}>
      <div className={styles.loginGlow} aria-hidden="true" />
      <Link className={styles.loginBack} href="/">
        <ArrowLeft size={15} /> Back to tMochi
      </Link>

      <section className={styles.loginPanel}>
        <div className={styles.loginBrand}>
          <CreatorBrand />
          <span>Creator Studio</span>
        </div>
        <div className={styles.loginIcon} aria-hidden="true">
          <LockKeyhole size={22} />
        </div>
        <span className={styles.eyebrow}>Private creator access</span>
        <h1>{view === "login" ? "Sign in to build" : "Create your Samsar"}<br />
          {view === "login" ? "branching stories." : "creator account."}
        </h1>
        <p className={styles.loginIntro}>
          {view === "login"
            ? "Use the same Samsar account you use on samsar.one. Your shared secure session will also work here on tMochi."
            : "Create credentials compatible with Samsar, the Gallery, and tMochi Creator Studio."}
        </p>

        <div className={styles.authTabs} role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={view === "login"}
            className={view === "login" ? styles.authTabActive : undefined}
            onClick={() => changeView("login")}
            disabled={submitting}
          >
            Log in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "register"}
            className={view === "register" ? styles.authTabActive : undefined}
            onClick={() => changeView("register")}
            disabled={submitting}
          >
            Sign up
          </button>
        </div>

        <form className={styles.loginForm} onSubmit={submitAuthentication}>
          {error && <div className={styles.formError} role="alert">{error}</div>}
          {restoringSession && (
            <div className={styles.sessionRestore} role="status">
              <LoaderCircle className={styles.spin} size={14} /> Restoring your Samsar session
            </div>
          )}
          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              disabled={submitting || restoringSession}
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete={view === "login" ? "current-password" : "new-password"}
              placeholder={view === "login" ? "Your Samsar password" : "Choose a password"}
              disabled={submitting || restoringSession}
              required
            />
          </label>
          <button className={styles.primaryButton} type="submit" disabled={submitting || restoringSession}>
            {submitting ? <LoaderCircle className={styles.spin} size={17} /> : <KeyRound size={17} />}
            {submitting
              ? view === "login" ? "Signing in" : "Creating account"
              : view === "login" ? "Continue with Samsar" : "Create Samsar account"}
            {!submitting && <ArrowRight size={16} />}
          </button>
        </form>

        {view === "register" && (
          <p className={styles.authLegal}>
            By creating an account, you confirm you are 18 or older and agree to the{" "}
            <a href="https://samsar.one/terms" target="_blank" rel="noreferrer">terms</a> and{" "}
            <a href="https://samsar.one/privacy" target="_blank" rel="noreferrer">privacy policy</a>.
          </p>
        )}

        <div className={styles.loginFoot}>
          <span>{view === "login" ? "New to Samsar?" : "Already have an account?"}</span>
          <button type="button" onClick={() => changeView(view === "login" ? "register" : "login")}>
            {view === "login" ? "Create an account" : "Log in"} <ArrowRight size={13} />
          </button>
        </div>
      </section>
    </main>
  );
}
