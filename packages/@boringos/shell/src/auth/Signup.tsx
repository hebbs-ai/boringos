// SPDX-License-Identifier: BUSL-1.1
//
// Signup screen. Lifted from boringos-crm/packages/web/src/pages/Signup.tsx
// with two changes:
//  - Sends `tenantName` (the framework's documented signup field) instead
//    of CRM's `orgName`
//  - Shell branding + plain Tailwind classes

import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "./AuthProvider.js";
import { useBrand } from "../branding/BrandProvider.js";

const inputClass =
  "w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15";

export function Signup() {
  const { signup } = useAuth();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteCode = searchParams.get("invite") ?? "";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isInvite = !!inviteCode;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signup({
        name,
        email,
        password,
        ...(isInvite ? { inviteCode } : { tenantName: tenantName || undefined }),
      });
      navigate("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-bg bg-cover bg-center"
      style={brand.loginBackground ? { backgroundImage: `url(${brand.loginBackground})` } : undefined}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {brand.logoUrl && (
            <img
              src={brand.logoUrl}
              alt={brand.productName}
              className="mx-auto mb-3 h-10 object-contain"
            />
          )}
          <h1 className="text-2xl font-bold tracking-tight text-text">
            {brand.productName}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {isInvite ? "Join your team" : "Create your tenant"}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-border bg-white p-6 shadow-sm"
        >
          {error && (
            <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {isInvite && (
            <div className="mb-4 rounded-md bg-accent-tint px-3 py-2 text-sm text-accent">
              You've been invited to join a team. Sign up to accept.
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="Your name"
              required
            />
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
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

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="Choose a password"
              required
              minLength={6}
            />
          </div>

          {!isInvite && (
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                Tenant name
              </label>
              <input
                type="text"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                className={inputClass}
                placeholder="Acme Corp"
              />
              <p className="mt-1 text-xs text-muted">Leave blank to use your name.</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent disabled:opacity-50"
          >
            {loading
              ? "Creating account…"
              : isInvite
                ? "Join team"
                : "Create tenant"}
          </button>

          <p className="mt-4 text-center text-sm text-muted">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-accent hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
