import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createFakeBackend, createFixtures, fakeTokenFor } from "@aarogyam/api-client/fake";

import { App } from "./app.js";
import { bookingUrl, slugFromHost, type SiteEnv } from "./env.js";
import { pageFor } from "./routes.js";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const ENV: SiteEnv = { apiMode: "fake", apiBaseUrl: "", bookingUrlTemplate: "https://{slug}.example.com/book" };
const HOST = "sunrise.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";

function backend() {
  const fake = createFakeBackend(createFixtures());
  return {
    owner: fake.client({ host: HOST, getToken: () => fakeTokenFor({ id: ASHA }) }),
    visitor: fake.client({ host: HOST, getToken: () => null }),
  };
}

describe("addresses", () => {
  it("finds the clinic slug and the booking page", () => {
    expect(slugFromHost("sunrise-site.aarogyam.example")).toBe("sunrise");
    expect(slugFromHost("www.sunrise.in")).toBeNull();
    expect(bookingUrl("https://{slug}.example.com/book", "sunrise-site.aarogyam.example")).toBe("https://sunrise.example.com/book");
    expect(bookingUrl("https://{slug}.example.com/book", "www.sunrise.in")).toBeNull();
    expect(bookingUrl("https://book.example.com", "www.sunrise.in")).toBe("https://book.example.com");
    expect(bookingUrl("", "x")).toBeNull();
  });

  it("maps paths to pages", () => {
    expect(pageFor("/")).toBe("home");
    expect(pageFor("/services/")).toBe("services");
    expect(pageFor("/contact")).toBe("contact");
    expect(pageFor("/nope")).toBe("home");
  });
});

describe("the live site", () => {
  it("says so while the clinic has not published", async () => {
    const { visitor } = backend();
    render(<App client={visitor} env={ENV} />);
    expect(await screen.findByRole("heading", { name: "This website is not available yet" })).toBeTruthy();
  });

  it("shows the published site with its title and structured data", async () => {
    const { owner, visitor } = backend();
    await owner.updateWebsite({ published: true, template: "clinical", palette: "mint" });
    render(<App client={visitor} env={ENV} />);
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    await waitFor(() => {
      expect(document.title).toContain("Sunrise Dental");
    });
    expect(JSON.parse(document.head.querySelector("script#cs-jsonld")?.textContent ?? "{}")).toMatchObject({ "@type": "Dentist", name: "Sunrise Dental" });
    expect(document.querySelector(".cs-t-clinical")).not.toBeNull();
  });

  it("moves between the pages of a multi-page site through the address bar", async () => {
    const { owner, visitor } = backend();
    await owner.updateWebsite({ published: true, layout: "multi" });
    render(<App client={visitor} env={ENV} />);
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Services" }));
    expect(window.location.pathname).toBe("/services");
    expect(await screen.findByRole("heading", { name: "Our services" })).toBeTruthy();
    await waitFor(() => {
      expect(document.title).toContain("Services and fees");
    });
  });
});
