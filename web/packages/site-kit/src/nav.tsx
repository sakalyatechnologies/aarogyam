import type { SiteContext, PageId } from "./types.js";
import { ToothIcon } from "./icons.js";

interface NavItem {
  key: string;
  label: string;
  /** The page it opens (multi-page) or `null` for a link to a section. */
  page: PageId | null;
  anchor: string;
}

/** The links in the header. Sections that would be empty are left out of the live site. */
export function navItems(ctx: SiteContext): NavItem[] {
  const { site, editing } = ctx;
  const gallery = site.photos.gallery.length > 0 || editing;
  if (site.design.layout === "multi") {
    return [
      { key: "home", label: "Home", page: "home", anchor: "" },
      { key: "about", label: "About", page: "about", anchor: "" },
      { key: "services", label: "Services", page: "services", anchor: "" },
      ...(gallery ? [{ key: "gallery", label: "Gallery", page: "gallery" as const, anchor: "" }] : []),
      { key: "contact", label: "Contact", page: "contact", anchor: "" },
    ];
  }
  return [
    { key: "services", label: "Services", page: null, anchor: "#services" },
    { key: "about", label: "About", page: null, anchor: "#about" },
    ...(site.doctors.length > 0 ? [{ key: "doctors", label: "Doctors", page: null, anchor: "#doctors" }] : []),
    ...(gallery ? [{ key: "gallery", label: "Gallery", page: null, anchor: "#gallery" }] : []),
    ...(site.reviews.length > 0 ? [{ key: "reviews", label: "Reviews", page: null, anchor: "#reviews" }] : []),
    { key: "contact", label: "Contact", page: null, anchor: "#contact" },
  ];
}

export function NavLinks({ ctx, className }: { ctx: SiteContext; className?: string }) {
  return (
    <nav className={className ?? "cs-nav"} aria-label="Main">
      <ul>
        {navItems(ctx).map((item) => (
          <li key={item.key}>
            <a
              href={item.page === null ? item.anchor : ctx.hrefFor(item.page)}
              {...(item.page !== null && item.page === ctx.page ? { "aria-current": "page" as const } : {})}
              onClick={(event) => {
                if (item.page !== null) {
                  event.preventDefault();
                  ctx.goto(item.page);
                }
              }}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The logo, or the clinic's name with a small tooth. */
export function Brand({ ctx }: { ctx: SiteContext }) {
  const { site } = ctx;
  const logo = site.photos.logo;
  const home = ctx.site.design.layout === "multi";
  return (
    <a
      className="cs-brand"
      href={home ? ctx.hrefFor("home") : "#top"}
      onClick={(event) => {
        if (home) {
          event.preventDefault();
          ctx.goto("home");
        }
      }}
    >
      {logo != null ? (
        <img src={`${ctx.assetBase}${logo.url}`} alt="" className="cs-logo" decoding="async" />
      ) : (
        <span className="cs-mark">
          <ToothIcon size={22} />
        </span>
      )}
      <span className="cs-brand-name">{site.clinic.name}</span>
    </a>
  );
}
