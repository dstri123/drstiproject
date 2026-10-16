import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api/axios";
import AuthHeroPanel from "../../components/AuthHeroPanel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Check,
  Loader2,
  ShieldCheck,
  Info,
  Copy,
} from "lucide-react";

const CODE_LENGTH = 6;

const PASSWORD_RULES = [
  { id: "length", label: "At least 8 characters", test: (p) => p.length >= 8 },
  { id: "alnum", label: "Letters and numbers", test: (p) => /[A-Za-z]/.test(p) && /\d/.test(p) },
  { id: "symbol", label: "At least one symbol (e.g. ! ? #)", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

// Role names shown when a non-admin account is sent to their admin instead.
const ROLE_LABELS = {
  project_manager: "Manager",
  manager: "Manager",
  data_contributor: "Data Contributor",
  project_engineer: "Project Engineer",
  site_engineer: "Site Engineer",
  member: "Member",
};

const apiError = (err, fallback) =>
  err.response?.data?.error || err.response?.data?.detail || fallback;

// ─── Shared bits ──────────────────────────────────────────────────────────────

function BackLink({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-black transition-colors mb-5"
    >
      <ArrowLeft className="h-4 w-4" />
      {children}
    </button>
  );
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 mb-4">
      <p className="text-xs text-red-800 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
        {message}
      </p>
    </div>
  );
}

function PrimaryButton({ loading, loadingText, children, ...props }) {
  return (
    <Button
      {...props}
      disabled={loading || props.disabled}
      className="w-full bg-black hover:bg-gray-900 text-white font-semibold text-sm py-2.5 rounded-lg transition-all disabled:bg-gray-300 disabled:text-gray-500 disabled:opacity-100"
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          {loadingText}
        </span>
      ) : (
        children
      )}
    </Button>
  );
}

function PasswordInput({ id, label, value, onChange, show, onToggle, disabled, invalid, autoFocus }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium text-black">
        {label}
      </Label>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          id={id}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={value}
          onChange={onChange}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={invalid}
          className={`text-sm border-gray-300 pl-9 pr-10 ${invalid ? "border-red-500 focus-visible:ring-red-500" : ""}`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggle}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

// ─── Step 1: email ──────────────────────────────────────────────────────────

// Shown instead of the email-code flow for roles whose password is managed by
// their admin (everyone except Super Admin / Admin).
function ContactAdminView({ role, admin, onBack, onSignIn }) {
  const [copied, setCopied] = useState(false);
  const roleLabel = ROLE_LABELS[role] || "Your";
  const initials = (admin?.name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(admin.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the address is still visible */
    }
  };

  return (
    <>
      <BackLink onClick={onBack}>Back</BackLink>
      <h2 className="text-2xl font-bold text-black mb-4">Forgot password</h2>

      <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2.5 mb-4">
        <p className="text-sm text-yellow-900 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          {roleLabel} passwords are reset by your admin, not by email.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm mb-4">
        <p className="text-[11px] font-semibold tracking-wider text-gray-500 uppercase mb-3">Your admin</p>
        {admin ? (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black text-sm font-semibold text-white">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-black truncate">{admin.name}</p>
                <p className="text-xs text-gray-500 truncate">
                  Primary admin{admin.organization ? ` · ${admin.organization}` : ""}
                </p>
                {admin.email && <p className="text-xs text-gray-500 truncate">{admin.email}</p>}
              </div>
            </div>
            {admin.email && (
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`mailto:${admin.email}?subject=${encodeURIComponent("Password reset request")}`}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-800 hover:border-gray-400 transition-colors"
                >
                  <Mail className="h-4 w-4" />
                  Email
                </a>
                <button
                  type="button"
                  onClick={copyEmail}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-800 hover:border-gray-400 transition-colors"
                >
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy email"}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-600">Contact your organisation's administrator.</p>
        )}
      </div>

      <p className="text-sm text-gray-600 mb-5">
        Your admin can set a new password for your account. Sign in with it once they share it with you.
      </p>

      <button
        type="button"
        onClick={onSignIn}
        className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 text-sm font-semibold text-black hover:bg-gray-100 transition-colors"
      >
        Back to sign in
      </button>
    </>
  );
}

function EmailStep({ email, setEmail, onSent, onBack }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Set when the backend says this role's password is managed by an admin.
  const [contactAdmin, setContactAdmin] = useState(null);
  const emailValid = /^\S+@\S+\.\S+$/.test(email.trim());

  const submit = async (e) => {
    e.preventDefault();
    if (!emailValid) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await API.post("auth/password-reset/request/", { email: email.trim() });
      onSent(res.data);
    } catch (err) {
      if (err.response?.status === 403) {
        setContactAdmin({ role: err.response.data?.role, admin: err.response.data?.admin });
      } else {
        setError(apiError(err, "Couldn't send the code. Please try again."));
      }
    } finally {
      setLoading(false);
    }
  };

  if (contactAdmin) {
    return (
      <ContactAdminView
        role={contactAdmin.role}
        admin={contactAdmin.admin}
        onBack={() => setContactAdmin(null)}
        onSignIn={onBack}
      />
    );
  }

  return (
    <>
      <BackLink onClick={onBack}>Back to sign in</BackLink>
      <h2 className="text-2xl font-bold text-black mb-1.5">Reset your password</h2>
      <p className="text-sm text-gray-600 mb-5">
        Enter the email for your admin account. We'll send you a 6-digit code.
      </p>

      <form onSubmit={submit} noValidate>
        <ErrorBanner message={error} />
        <div className="space-y-1.5 mb-4">
          <Label htmlFor="reset-email" className="text-sm font-medium text-black">
            Email
          </Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              id="reset-email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
              disabled={loading}
              autoFocus
              className="text-sm border-gray-300 pl-9"
            />
          </div>
        </div>
        <PrimaryButton type="submit" loading={loading} loadingText="Sending code..." disabled={!email.trim()}>
          Send code
        </PrimaryButton>
      </form>
    </>
  );
}

// ─── Step 2: 6-digit code ─────────────────────────────────────────────────────

function CodeStep({ email, maskedEmail, initialCooldown, onVerified, onBack }) {
  const [digits, setDigits] = useState(Array(CODE_LENGTH).fill(""));
  const [error, setError] = useState("");
  const [triesLeft, setTriesLeft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(initialCooldown);
  const inputs = useRef([]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const code = digits.join("");
  const complete = code.length === CODE_LENGTH;
  const locked = triesLeft === 0;

  const setAt = (index, value) => {
    setDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (error && !locked) setError("");
  };

  const handleChange = (index, raw) => {
    const value = raw.replace(/\D/g, "");
    if (!value) {
      setAt(index, "");
      return;
    }
    if (value.length > 1) {
      fill(value, index);
      return;
    }
    setAt(index, value);
    if (index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  const fill = (value, start = 0) => {
    const chars = value.replace(/\D/g, "").slice(0, CODE_LENGTH - start).split("");
    setDigits((prev) => {
      const next = [...prev];
      chars.forEach((c, i) => (next[start + i] = c));
      return next;
    });
    if (error && !locked) setError("");
    inputs.current[Math.min(start + chars.length, CODE_LENGTH - 1)]?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
      setAt(index - 1, "");
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    if (!complete || locked) return;
    setLoading(true);
    try {
      const res = await API.post("auth/password-reset/verify/", { email, code });
      onVerified(res.data.reset_token);
    } catch (err) {
      setError(apiError(err, "Couldn't verify the code. Please try again."));
      const left = err.response?.data?.tries_left;
      if (typeof left === "number") setTriesLeft(left);
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setResending(true);
    try {
      const res = await API.post("auth/password-reset/request/", { email });
      setDigits(Array(CODE_LENGTH).fill(""));
      setError("");
      setTriesLeft(null);
      setCooldown(res.data.resend_in || 30);
      inputs.current[0]?.focus();
    } catch (err) {
      setError(apiError(err, "Couldn't resend the code. Please try again."));
    } finally {
      setResending(false);
    }
  };

  const hasError = !!error;
  const mm = String(Math.floor(cooldown / 60)).padStart(2, "0");
  const ss = String(cooldown % 60).padStart(2, "0");

  return (
    <form onSubmit={verify} noValidate>
      <BackLink onClick={onBack}>Back</BackLink>
      <h2 className="text-2xl font-bold text-black mb-1.5">Check your email</h2>
      <p className="text-sm text-gray-600 mb-6">
        We sent a 6-digit code to <span className="font-medium text-black">{maskedEmail}</span>.
      </p>

      <div className="flex justify-between gap-2 mb-3" onPaste={(e) => {
        e.preventDefault();
        fill(e.clipboardData.getData("text"));
      }}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => (inputs.current[i] = el)}
            value={d}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={CODE_LENGTH}
            autoFocus={i === 0}
            disabled={loading || locked}
            aria-label={`Digit ${i + 1}`}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onFocus={(e) => e.target.select()}
            className={`h-14 w-full min-w-0 rounded-lg border text-center text-2xl font-semibold outline-none transition-all ${
              hasError
                ? "border-red-400 bg-red-50 text-red-700"
                : "border-gray-300 text-black focus:border-black focus:ring-2 focus:ring-black/10"
            } disabled:opacity-70`}
          />
        ))}
      </div>

      {hasError && (
        <p role="alert" className="text-xs text-red-700 flex items-center gap-1.5 mb-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="mb-5 text-xs">
        {cooldown > 0 ? (
          <span className="text-gray-500">
            Resend code in {mm}:{ss}
          </span>
        ) : (
          <button
            type="button"
            onClick={resend}
            disabled={resending}
            className="font-medium text-black underline-offset-2 hover:underline disabled:text-gray-400"
          >
            {resending ? "Sending..." : "Resend code"}
          </button>
        )}
      </div>

      <PrimaryButton type="submit" loading={loading} loadingText="Verifying..." disabled={!complete || locked}>
        Verify
      </PrimaryButton>
    </form>
  );
}

// ─── Step 3: new password ─────────────────────────────────────────────────────

function NewPasswordStep({ resetToken, onDone, onExpired }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState({ password: false, confirm: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const rules = useMemo(
    () => [
      ...PASSWORD_RULES.map((r) => ({ ...r, met: r.test(password) })),
      { id: "match", label: "Both passwords match", met: !!confirm && confirm === password },
    ],
    [password, confirm]
  );
  const valid = rules.every((r) => r.met);
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    setError("");
    try {
      await API.post("auth/password-reset/confirm/", { reset_token: resetToken, new_password: password });
      onDone();
    } catch (err) {
      const msg = apiError(err, "Couldn't save your password. Please try again.");
      if (/expired/i.test(msg)) onExpired(msg);
      else setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2 className="text-2xl font-bold text-black mb-1.5">Create a new password</h2>
      <p className="text-sm text-gray-600 mb-5">Choose a password you haven't used before.</p>

      <ErrorBanner message={error} />

      <div className="space-y-4 mb-4">
        <PasswordInput
          id="new-password"
          label="New password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
          show={show.password}
          onToggle={() => setShow((s) => ({ ...s, password: !s.password }))}
          disabled={loading}
          autoFocus
        />
        <PasswordInput
          id="confirm-password"
          label="Confirm new password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setError("");
          }}
          show={show.confirm}
          onToggle={() => setShow((s) => ({ ...s, confirm: !s.confirm }))}
          disabled={loading}
          invalid={mismatch}
        />
      </div>

      <ul className="space-y-1.5 mb-5">
        {rules.map((r) => (
          <li
            key={r.id}
            className={`flex items-center gap-2 text-xs transition-colors ${
              r.met ? "text-green-700" : r.id === "match" && mismatch ? "text-red-600" : "text-gray-500"
            }`}
          >
            {r.met ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <XCircle className={`h-4 w-4 shrink-0 ${r.id === "match" && mismatch ? "" : "text-gray-400"}`} />
            )}
            {r.label}
          </li>
        ))}
      </ul>

      <PrimaryButton type="submit" loading={loading} loadingText="Saving..." disabled={!valid}>
        Save password
      </PrimaryButton>
    </form>
  );
}

// ─── Step 4: done ─────────────────────────────────────────────────────────────

function DoneStep({ onSignIn }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900">
          <Check className="h-5 w-5 text-white" strokeWidth={3} />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-black mb-2">Password changed</h2>
      <p className="text-sm text-gray-600 mb-6">You can now sign in with your new password.</p>
      <PrimaryButton type="button" onClick={onSignIn}>
        Sign in
      </PrimaryButton>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState({ masked: "", resendIn: 30 });
  const [resetToken, setResetToken] = useState("");
  const [notice, setNotice] = useState("");

  const goToLogin = () => navigate("/login");

  return (
    <div className="h-screen flex flex-row-reverse bg-white overflow-hidden">
      {/* Right Side - Form */}
      <div className="w-full lg:w-1/2 h-full flex items-center justify-center px-4 py-6 overflow-y-auto">
        <div className="w-full max-w-sm my-auto">
          {/* Brand — centred above the form, as on the Sign In page */}
          <div className="text-center mb-8">
            <img src="/distri-logo.png" alt="C Twin Logo" className="h-14 mx-auto mb-2 object-contain" />
            <h1 className="text-xl font-bold text-black leading-tight">C Twin</h1>
            <p className="text-xs text-gray-600 mt-0.5">Next Generation Progress Analytics</p>
          </div>

          <div>
            {notice && step === "email" && <ErrorBanner message={notice} />}

            {step === "email" && (
              <EmailStep
                email={email}
                setEmail={setEmail}
                onBack={goToLogin}
                onSent={(data) => {
                  setNotice("");
                  setSent({ masked: data.email || email, resendIn: data.resend_in || 30 });
                  setStep("code");
                }}
              />
            )}

            {step === "code" && (
              <CodeStep
                email={email.trim()}
                maskedEmail={sent.masked}
                initialCooldown={sent.resendIn}
                onBack={() => setStep("email")}
                onVerified={(token) => {
                  setResetToken(token);
                  setStep("password");
                }}
              />
            )}

            {step === "password" && (
              <NewPasswordStep
                resetToken={resetToken}
                onDone={() => setStep("done")}
                onExpired={(msg) => {
                  setNotice(msg);
                  setStep("email");
                }}
              />
            )}

            {step === "done" && <DoneStep onSignIn={goToLogin} />}
          </div>

          <p className="mt-8 text-xs text-gray-500 flex items-center justify-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            Secure password reset with encrypted connection
          </p>
        </div>
      </div>

      {/* Left Side - BIM image (same as Sign In page; hidden on mobile) */}
      <AuthHeroPanel />
    </div>
  );
}
