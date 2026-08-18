import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import ViewerPage from "../pages/viewer/ViewerPage";
import AnalyticsPage from "../pages/analytics/AnalyticsPage";
import ProgressAssessmentPage from "../pages/analytics/ProgressAssessmentPage";

const SECTION_PATTERN = /^\/(viewer|analytics|progress)\/([^/?#]+)/;

// Keeps the 3D viewer (and the Analytics comparison scene) mounted across
// navigation between the Viewer, Analytics, and Progress Assessment pages.
// These three used to be separate top-level <Route>s, so React Router fully
// unmounted whichever one you navigated away from — destroying the loaded
// BIM/point-cloud models and forcing a full reload when you came back.
//
// Rendered as a permanent sibling of <Routes> (see App.js), this component
// reads the current URL directly instead of relying on route matching, and
// renders whichever page(s) have ever been visited as always-mounted
// children, toggling visibility with CSS `display` instead of conditionally
// mounting/unmounting them. Each page mounts once on first visit and then
// stays alive (hidden, not destroyed) whenever you switch away — so
// reopening it is instant, with the same loaded models, camera position, and
// selection state.
export default function PersistentWorkspace() {
  const location = useLocation();
  const match = SECTION_PATTERN.exec(location.pathname);
  const section = match?.[1] ?? null;
  const slug = match?.[2] ?? null;

  // Which sections have ever been visited, and with what slug. A section
  // only mounts once first visited, then never unmounts. If the user opens a
  // DIFFERENT project's viewer/analytics/progress, that section's `key`
  // below changes, which intentionally remounts just that page — a
  // different project legitimately needs a fresh load.
  const [mounted, setMounted] = useState({
    viewer: null,
    analytics: null,
    progress: null,
  });

  useEffect(() => {
    if (!section || !slug) return;
    setMounted((prev) =>
      prev[section] === slug ? prev : { ...prev, [section]: slug },
    );
  }, [section, slug]);

  const visibility = (isActive) => ({
    display: isActive ? undefined : "none",
  });

  return (
    <>
      {mounted.viewer && (
        <div style={visibility(section === "viewer")}>
          <ViewerPage key={mounted.viewer} projectSlug={mounted.viewer} />
        </div>
      )}
      {mounted.analytics && (
        <div style={visibility(section === "analytics")}>
          <AnalyticsPage
            key={mounted.analytics}
            routeParam={mounted.analytics}
          />
        </div>
      )}
      {mounted.progress && (
        <div style={visibility(section === "progress")}>
          <ProgressAssessmentPage
            key={mounted.progress}
            routeParam={mounted.progress}
          />
        </div>
      )}
    </>
  );
}
