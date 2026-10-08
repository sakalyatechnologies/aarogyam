// Aarogyam-owned. The one sign-in for everyone, styled with the Lovable site's own classes.
import { useEffect, useState } from "react";

import { fetchMe, handoffUrl, requestHandoff } from "./api";
import { getAuthClient, signInConfigured, verifiedAccessToken } from "./auth";
import { CONSOLE_URL } from "./env";
import { LegalLinks } from "./legal/LegalLinks";
import { Showcase } from "./Showcase";
import { decideDestination, resolveNext, type Destination } from "./routing";

type Step = "email" | "code" | "password" | "routing";

export function SignInPage({ onBack, onRegister }: { onBack: () => void; onRegister: () => void }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<Extract<Destination, { kind: "picker" }> | null>(null);
  const [none, setNone] = useState(false);
  const [token, setToken] = useState("");

  const goTo = async (accessToken: string) => {
    setStep("routing");
    setErr("");
    const me = await fetchMe(accessToken);
    if (!me.ok) {
      setErr(me.message);
      setStep("email");
      return;
    }
    // `?next=` (set by a clinic or the console) goes first, but only to a place this person belongs to.
    const wanted = resolveNext(me.value, new URLSearchParams(window.location.search).get("next"), CONSOLE_URL);
    const dest: Destination = wanted === null ? decideDestination(me.value, CONSOLE_URL) : { kind: "go", place: wanted };
    setToken(accessToken);
    if (dest.kind === "go") await openPlace(accessToken, dest.place.host);
    else if (dest.kind === "picker") setPicker(dest);
    else setNone(true);
  };

  // A one-time code signs the person in on the clinic's (or the console's) own host.
  const openPlace = async (accessToken: string, host: string) => {
    setErr("");
    const handoff = await requestHandoff(accessToken, host);
    if (!handoff.ok) {
      setErr(handoff.message);
      return;
    }
    window.location.assign(handoffUrl(host, handoff.value));
  };

  // Someone who already signed in on this browser skips the form.
  useEffect(() => {
    if (!signInConfigured) return;
    void verifiedAccessToken().then(async (t) => {
      if (t !== null) await goTo(t);
    });
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (work: () => Promise<{ ok: true } | { ok: false; message: string }>, next: () => Promise<void> | void) => {
    setBusy(true);
    setErr("");
    const out = await work();
    setBusy(false);
    if (out.ok) await next();
    else setErr(out.message);
  };

  const sendCode = async () => {
    if (!email.trim()) return setErr("Enter your email address.");
    const auth = await getAuthClient();
    await run(() => auth.requestCode(email.trim()), () => setStep("code"));
  };
  const verify = async () => {
    const auth = await getAuthClient();
    await run(() => auth.verifyCode(email.trim(), code), async () => {
      const t = await auth.getAccessToken();
      if (t !== null) await goTo(t);
    });
  };
  const withPassword = async () => {
    const auth = await getAuthClient();
    await run(() => auth.signInWithPassword(email.trim(), password), async () => {
      const t = await auth.getAccessToken();
      if (t !== null) await goTo(t);
    });
  };

  return (
    <div className="v4-auth">
      <aside className="v4-auth-left"><Showcase /></aside>
      <div className="v4-auth-right">
      <div className="auth-page">
      <div className="wrap">
        <button className="backlink" onClick={onBack}>← Back to home</button>
        <div className="auth-card rv in">
          <div className="eyebrow">Sign in</div>
          <h2 className="font-d">One portal. Every role, routed.</h2>
          <p className="auth-sub">Sign in with your work email. We take you to the right place automatically.</p>

          {!signInConfigured && <p className="auth-err">Sign-in is not connected on this site yet.</p>}

          {signInConfigured && step === "email" && (
            <div className="field" style={{ marginTop: 22 }}>
              <label htmlFor="si-email">Email</label>
              <input id="si-email" type="email" autoComplete="email" value={email} placeholder="dr.meera@smilecare.in"
                onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void sendCode()} />
              <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 14 }} disabled={busy} onClick={() => void sendCode()}>
                {busy ? "Sending…" : "Email me a code →"}
              </button>
              <p className="auth-note">
                <a onClick={() => { setErr(""); setStep("password"); }} style={{ cursor: "pointer", color: "var(--ac)" }}>Use a password instead</a>
              </p>
            </div>
          )}

          {signInConfigured && step === "code" && (
            <div className="field" style={{ marginTop: 22 }}>
              <div className="routed-chip">Code sent to <b>{email}</b></div>
              <label htmlFor="si-code" style={{ marginTop: 16 }}>Enter the 6-digit code</label>
              <input id="si-code" className="otp-input" inputMode="numeric" autoComplete="one-time-code" value={code} placeholder="••••••"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => e.key === "Enter" && void verify()} />
              <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 14 }} disabled={busy || code.length !== 6} onClick={() => void verify()}>
                {busy ? "Checking…" : "Sign in →"}
              </button>
              <p className="auth-note"><a onClick={() => { setCode(""); setErr(""); setStep("email"); }} style={{ cursor: "pointer", color: "var(--ac)" }}>Use a different email or send a new code</a></p>
            </div>
          )}

          {signInConfigured && step === "password" && (
            <div className="field" style={{ marginTop: 22 }}>
              <label htmlFor="si-email2">Email</label>
              <input id="si-email2" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <label htmlFor="si-pw" style={{ marginTop: 14 }}>Password</label>
              <input id="si-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void withPassword()} />
              <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 14 }} disabled={busy} onClick={() => void withPassword()}>
                {busy ? "Signing in…" : "Sign in →"}
              </button>
              <p className="auth-note"><a onClick={() => { setErr(""); setStep("email"); }} style={{ cursor: "pointer", color: "var(--ac)" }}>Email me a code instead</a></p>
            </div>
          )}

          {step === "routing" && !picker && !none && <p className="auth-sub" style={{ marginTop: 22 }}>Taking you there…</p>}

          {picker && (
            <div className="field" style={{ marginTop: 22 }}>
              <label>Choose where to go</label>
              {picker.places.map((p) => (
                <button key={p.key} className="btn ghost" style={{ width: "100%", justifyContent: "space-between", marginTop: 10 }}
                  onClick={() => void openPlace(token, p.host)}>
                  <span>{p.name}</span><span style={{ opacity: 0.7 }}>{p.detail}</span>
                </button>
              ))}
            </div>
          )}

          {none && <p className="auth-sub" style={{ marginTop: 22 }}>You are signed in, but not part of a clinic yet. Check your invitation email, or ask your clinic owner.</p>}

          {err && <p className="auth-err" role="alert">{err}</p>}
          {step !== "routing" && (
            <p className="auth-note">New here? <a onClick={onRegister} style={{ cursor: "pointer", color: "var(--ac)" }}>Request access</a></p>
          )}
        </div>
        <LegalLinks />
      </div>
      </div>
      </div>
    </div>
  );
}
