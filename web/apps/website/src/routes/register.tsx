import { createFileRoute, useNavigate } from "@tanstack/react-router";
import RegisterView from "@/landing/views/RegisterView.jsx";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Request access — Aarogyam" },
      { name: "description", content: "Apply for Aarogyam for your clinic." },
      { property: "og:title", content: "Request access — Aarogyam" },
      { property: "og:description", content: "Apply for Aarogyam for your clinic." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Register,
});

function Register() {
  const navigate = useNavigate();
  return (
    <RegisterView
      onBack={() => navigate({ to: "/" })}
      onSignIn={() => navigate({ to: "/sign-in" })}
    />
  );
}
