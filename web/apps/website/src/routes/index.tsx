import { createFileRoute, useNavigate } from "@tanstack/react-router";
import SiteView from "@/landing/views/SiteView.jsx";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aarogyam — Run your entire clinic from one calm place" },
      { name: "description", content: "Aarogyam is the clinic OS for modern India — appointments, patient records, billing, prescriptions and analytics in one calm system." },
      { property: "og:title", content: "Aarogyam — Run your entire clinic from one calm place" },
      { property: "og:description", content: "Appointments, patient records, billing, prescriptions and analytics for Indian clinics." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  return <SiteView onRegister={() => navigate({ to: "/register" })} onSignIn={() => navigate({ to: "/sign-in" })} />;
}
