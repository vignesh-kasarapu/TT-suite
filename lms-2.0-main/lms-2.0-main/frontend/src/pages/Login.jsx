import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import BackgroundEffects from '../components/login/BackgroundEffects';
import Header from '../components/login/Header';
import HeroSection from '../components/login/HeroSection';
import LoginCard from '../components/login/LoginCard';
import { BASE_URL, asset, portalLoginUrl } from '../api/paths';

/** TT Suite: the LMS has no sign-in of its own — the portal's /login does it and comes
 * back to `returnTo`. Reaching /lms/login without an error forwards straight there; with
 * an error (e.g. the first /employees/me call failed for a non-auth reason) the card
 * explains it and offers the portal sign-in. */
export default function Login() {
  const [searchParams] = useSearchParams();
  const signInError = searchParams.get('error');
  const requested = searchParams.get('returnTo');
  // Only same-app paths: never forward to an arbitrary URL.
  const returnTo = requested && requested.startsWith(BASE_URL) ? requested : BASE_URL;

  useEffect(() => {
    if (!signInError) window.location.replace(portalLoginUrl(returnTo));
  }, [signInError, returnTo]);

  if (!signInError) return null;

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <BackgroundEffects />
      <Header />

      <div className="min-h-screen flex items-center px-6 py-24 lg:px-[70px] lg:py-28">
        <div className="w-full max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-[1.6fr,1fr] gap-16 items-center">
          <HeroSection />

          {/* Mobile-only compact brand header, shown when the hero column is hidden */}
          <div className="lg:hidden flex items-center justify-center gap-3">
            <img src={asset('brand/tektalis.svg')} alt="Tektalis" style={{ height: 26 }} />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut', delay: 0.15 }}
          >
            <LoginCard signInError={signInError} returnTo={returnTo} />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
