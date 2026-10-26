import { motion } from 'framer-motion';
import HeroBadge from './HeroBadge';
import HeroHeading from './HeroHeading';
import HeroDescription from './HeroDescription';
import FeatureHighlights from './FeatureHighlights';
import DashboardPreview from './DashboardPreview';

export default function HeroSection() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
      className="hidden lg:flex flex-col"
    >
      <HeroBadge />
      <div className="mt-6">
        <HeroHeading />
      </div>
      <div className="mt-5">
        <HeroDescription />
      </div>
      <div className="mt-9">
        <FeatureHighlights />
      </div>
      <DashboardPreview />
    </motion.div>
  );
}
