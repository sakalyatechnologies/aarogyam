import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TEMPLATES } from "./catalog.js";
import { ClinicSite } from "./clinic-site.js";
import { formatFee, formatTime, hoursRows } from "./format.js";
import { sampleSite } from "./sample.js";
import { applySeo, seoFor } from "./seo.js";
import type { PageId } from "./types.js";

afterEach(cleanup);

describe("formatting", () => {
  it("shows rupees the Indian way and hours in the 12-hour clock", () => {
    expect(formatFee(150_000)).toBe("₹1,500");
    expect(formatFee(12_500_000)).toBe("₹1,25,000");
    expect(formatFee(150_050)).toBe("₹1,500.50");
    expect(formatTime("09:00")).toBe("9 AM");
    expect(formatTime("13:30")).toBe("1:30 PM");
    expect(formatTime("00:00")).toBe("12 AM");
  });

  it("groups days that share hours and marks closed days", () => {
    const rows = hoursRows(sampleSite().hours);
    expect(rows[0]).toMatchObject({ label: "Mon – Fri", text: "9 AM – 1 PM, 4 PM – 8 PM", closed: false });
    expect(rows[1]).toMatchObject({ label: "Saturday", text: "9 AM – 2 PM" });
    expect(rows[2]).toMatchObject({ label: "Sunday", text: "Closed", closed: true });
  });
});

describe.each(TEMPLATES.flatMap((t) => t.palettes.slice(0, 1).map((p) => [t.id, p.id] as const)))("%s design (%s)", (template, palette) => {
  const design = { template, palette, fonts: "modern" } as const;

  it("renders a one-page site with every section, landmarks and one h1", () => {
    const site = sampleSite({ design: { layout: "one", ...design } });
    const { container } = render(<ClinicSite site={site} bookingUrl="/book" />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    for (const heading of ["Our services", "Meet our doctors", "What patients say", "Contact and booking"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    expect(screen.getAllByText("Zirconia crown").length).toBeGreaterThan(0);
    expect(screen.getByText("₹12,500")).toBeTruthy();
    expect(screen.getByText("BDS, MDS (Orthodontics)")).toBeTruthy();
    expect(container.querySelector(`.cs-t-${template}`)).not.toBeNull();
    // Every picture has an alt attribute (empty only when decorative).
    for (const image of container.querySelectorAll("img")) {
      expect(image.hasAttribute("alt")).toBe(true);
    }
  });

  it("lets the visitor open the booking flow only on request", () => {
    const site = sampleSite({ design: { layout: "one", ...design } });
    const { container } = render(<ClinicSite site={site} bookingUrl="https://sunrise.example/book" />);
    expect(container.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start booking" }));
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("https://sunrise.example/book");
    expect(frame?.getAttribute("title")).toBe("Book an appointment");
  });

  it("walks the pages of a multi-page site", () => {
    const site = sampleSite({ design: { layout: "multi", ...design } });
    const visited: PageId[] = [];
    const { rerender } = render(<ClinicSite site={site} page="home" onNavigate={(p) => visited.push(p)} hrefFor={(p) => `/${p}`} />);
    expect(screen.queryByRole("heading", { name: "Contact and booking" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Our services" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Contact" }));
    expect(visited).toEqual(["contact"]);
    rerender(<ClinicSite site={site} page="contact" onNavigate={(p) => visited.push(p)} hrefFor={(p) => `/${p}`} />);
    expect(screen.getByRole("heading", { name: "Contact and booking" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Contact" }).getAttribute("aria-current")).toBe("page");
    rerender(<ClinicSite site={site} page="about" hrefFor={(p) => `/${p}`} />);
    expect(screen.getByRole("heading", { name: "Meet our doctors" })).toBeTruthy();
  });

  it("falls back to default wording and call-to-book when the owner wrote nothing and booking is off", () => {
    const site = sampleSite({ design: { layout: "one", ...design }, booking_enabled: false, doctors: [], reviews: [], photos: { gallery: [] } });
    render(<ClinicSite site={site} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Healthy smiles, gently cared for");
    expect(screen.getByText(/Call \+91 20261 23456 to book/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Meet our doctors" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "A look around" })).toBeNull();
  });
});

describe("inline editing", () => {
  it("reports edited text with its path and keeps defaults when text is cleared", () => {
    const calls: [string, string][] = [];
    const site = sampleSite();
    render(<ClinicSite site={site} edit={{ setText: (path, value) => calls.push([path, value]), pickPhoto: vi.fn() }} />);
    const headline = screen.getByRole("textbox", { name: "Headline" });
    headline.textContent = "Smiles for every age";
    fireEvent.blur(headline);
    expect(calls).toEqual([["hero.headline", "Smiles for every age"]]);
    const bio = screen.getByRole("textbox", { name: "Introduction of Dr Asha Rao" });
    bio.textContent = "Braces and aligners.";
    fireEvent.blur(bio);
    expect(calls[1]).toEqual(["doctors.d1.bio", "Braces and aligners."]);
    // Untouched text reports nothing.
    fireEvent.blur(screen.getByRole("textbox", { name: "Subheading" }));
    expect(calls).toHaveLength(2);
  });

  it("offers picture buttons for the top picture and the gallery", () => {
    const pick = vi.fn();
    render(<ClinicSite site={sampleSite()} edit={{ setText: vi.fn(), pickPhoto: pick }} />);
    fireEvent.click(screen.getByRole("button", { name: "Change top picture" }));
    expect(pick).toHaveBeenCalledWith("hero", expect.objectContaining({ id: "h1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a gallery picture" }));
    expect(pick).toHaveBeenLastCalledWith("gallery", null);
  });

  it("is plain text on the live site", () => {
    render(<ClinicSite site={sampleSite()} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /top picture/ })).toBeNull();
  });
});

describe("search and sharing", () => {
  it("builds a title, description and schema.org Dentist from public data only", () => {
    const site = sampleSite();
    const seo = seoFor(site, "home", "https://sunrise-site.example");
    expect(seo.title).toBe("Sunrise Dental Clinic | Dental clinic in Pune");
    expect(seo.description.length).toBeLessThanOrEqual(160);
    expect(seo.jsonLd).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Dentist",
      name: "Sunrise Dental Clinic",
      telephone: "+912026123456",
      address: { "@type": "PostalAddress", addressLocality: "Pune", postalCode: "411001", addressCountry: "IN" },
    });
    expect(JSON.stringify(seo.jsonLd)).toContain("OpeningHoursSpecification");
    expect(seo.image).toBe("https://sunrise-site.example/api/v1/public/site/photos/h1");
  });

  it("uses the owner's own title and description, and names pages on a multi-page site", () => {
    const site = sampleSite({ design: { layout: "multi", template: "hearth", palette: "sage", fonts: "friendly" }, seo: { title: "Best dentist in Pune", description: "Gentle dentistry." } });
    expect(seoFor(site, "home").title).toBe("Best dentist in Pune");
    expect(seoFor(site, "services").title).toBe("Services and fees | Sunrise Dental Clinic");
    expect(seoFor(site, "home").description).toBe("Gentle dentistry.");
  });

  it("writes tags into the head and escapes the JSON-LD", () => {
    const site = sampleSite();
    site.clinic.name = "Smile </script><b>";
    act(() => {
      applySeo(document, seoFor(site, "home", "https://x.example"), "#123456");
    });
    expect(document.title).toContain("Smile");
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBeTruthy();
    expect(document.head.querySelector('meta[property="og:title"]')).not.toBeNull();
    const script = document.head.querySelector("script#cs-jsonld");
    expect(script?.textContent).not.toContain("</script>");
    expect(JSON.parse(script?.textContent ?? "{}")).toMatchObject({ "@type": "Dentist" });
  });
});
