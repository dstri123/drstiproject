import BIMLayersHero from "./BIMLayersHero";

// Shared animated BIM panel for the auth pages (Login, Signup, Forgot Password).
// Hidden below lg; `className` sets the divider side for the page layout.
export default function AuthHeroPanel({ className = "border-r" }) {
  return (
    <div
      className={`hidden lg:block w-1/2 min-h-screen relative overflow-hidden border-blue-50 ${className}`}
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(37,99,235,0.09) 1px, transparent 0), radial-gradient(ellipse at 42% 45%, #ffffff 0%, #f4f7ff 58%, #e8effe 100%)",
        backgroundSize: "24px 24px, 100% 100%",
      }}
    >
      <BIMLayersHero />
    </div>
  );
}
