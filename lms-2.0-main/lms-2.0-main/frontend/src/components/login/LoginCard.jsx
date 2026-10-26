import { ShieldCheck, AlertTriangle } from 'lucide-react';
import GlassCard from '../common/GlassCard';
import { BASE_URL, asset, portalLoginUrl } from '../../api/paths';

function MicrosoftLogo() {
  // Real four-color Microsoft logo, not a stand-in glyph.
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

/** TT Suite: sign-in happens on the portal (/login), which comes back to `returnTo`. */
export default function LoginCard({ signInError, returnTo = BASE_URL }) {
  return (
    <GlassCard strong className="w-full max-w-[440px] mx-auto text-center">
      <img src={asset('brand/tektalis.png')} alt="Tektalis" className="mx-auto mb-4" style={{ height: 32 }} />

      <p className="small muted">Leave Management System</p>

      <div className="h-px my-6 bg-border" />

      {signInError && (
        <div className="alert alert--danger text-left mb-6">
          <AlertTriangle />
          <span>{signInError}</span>
        </div>
      )}

      <p className="h3 text-accent-text">Welcome!</p>
      <p className="small muted mt-2 mb-8" style={{ lineHeight: 'var(--line-height)' }}>
        Sign in with your Microsoft account
        <br />
        to continue
      </p>

      <a href={portalLoginUrl(returnTo)} className="btn btn--primary w-full">
        <MicrosoftLogo />
        Sign in with Microsoft
      </a>

      <p className="small muted mt-6">
        Trouble signing in? Contact your HR administrator.
      </p>

      <div className="flex items-center justify-center gap-1.5 small muted mt-5">
        <ShieldCheck size={13} />
        Secure login powered by Microsoft Entra ID
      </div>
    </GlassCard>
  );
}
