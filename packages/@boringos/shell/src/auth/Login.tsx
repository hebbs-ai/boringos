// SPDX-License-Identifier: BUSL-1.1
//
// Login screen — the website→product handoff. Dark hero on the left
// (orbs + gradient text + Space Grotesk wordmark, mirroring the
// marketing site's hero idiom) with the auth form on the warm-beige
// right panel. After login, the operator drops into the work shell
// where motion is restrained.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "./AuthProvider.js";
import { useBrand } from "../branding/BrandProvider.js";
import { Button } from "../components/ui/button.js";

const inputClass =
  "w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-tint";

export function Login() {
  const { login } = useAuth();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      {/* ── Hero panel — marketing-style dark surface with drifting orbs */}
      <aside
        className="band-dark relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between"
        style={
          brand.loginBackground
            ? { backgroundImage: `url(${brand.loginBackground})`, backgroundSize: "cover" }
            : undefined
        }
      >
        <div className="orb orb-amber" style={{ top: "-100px", left: "10%" }} />
        <div className="orb orb-cyan" style={{ top: "30%", right: "-80px" }} />
        <div className="orb orb-green" style={{ bottom: "-50px", left: "20%" }} />

        <div className="relative z-10 px-12 pt-16">
          <div className="flex items-center gap-3">
            {brand.logoUrl ? (
              <img
                src={brand.logoUrl}
                alt={brand.productName}
                className="h-7 w-7 rounded-md object-contain"
              />
            ) : (
              <span
                className="text-2xl"
                style={{ color: brand.primaryColor }}
                aria-hidden
              >
                ◉
              </span>
            )}
            <span
              className="font-logo text-lg font-bold tracking-[0.06em] text-white"
            >
              {brand.productName}
            </span>
          </div>
        </div>

        <div className="relative z-10 px-12 pb-20">
          <p className="font-mono text-[11px] uppercase tracking-[4px] text-amber-400/80">
            Welcome back
          </p>
          <h1
            className="mt-4 font-logo text-4xl font-bold leading-[1.05] tracking-tight md:text-5xl"
            style={{ color: "#F8FAFC" }}
          >
            Run your{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #F59E0B 0%, #F97316 40%, #FB923C 100%)",
              }}
            >
              cabinet.
            </span>
          </h1>
          {brand.productTagline && (
            <p className="mt-5 max-w-md text-sm leading-relaxed text-slate-300">
              {brand.productTagline}
            </p>
          )}
          <p className="mt-5 max-w-md text-sm leading-relaxed text-slate-300">
            Sign in to manage your agents, inbox, and tasks.
          </p>
        </div>
      </aside>

      {/* ── Auth form panel */}
      <main className="flex items-center justify-center bg-bg-warm px-6 py-16">
        <div className="w-full max-w-sm">
          {/* Compact mobile-only logo */}
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt={brand.productName} className="h-7 w-7 rounded-md" />
            ) : (
              <span className="text-2xl" style={{ color: brand.primaryColor }}>
                ◉
              </span>
            )}
            <span className="font-logo text-lg font-bold tracking-[0.06em] text-text">
              {brand.productName}
            </span>
          </div>

          <h2 className="text-xl font-semibold text-text">Sign in</h2>
          <p className="mt-1 text-xs text-muted">
            Enter your credentials to continue.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-6 rounded-lg border border-border bg-surface-raised p-6 shadow-sm"
          >
            {error && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="mb-4">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="you@company.com"
                required
              />
            </div>

            <div className="mb-6">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder="••••••••"
                required
              />
            </div>

            <Button type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? "Signing in…" : "Sign in"}
            </Button>

            <p className="mt-4 text-center text-xs text-muted">
              No account?{" "}
              <Link to="/signup" className="font-medium text-accent hover:underline">
                Sign up
              </Link>
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
