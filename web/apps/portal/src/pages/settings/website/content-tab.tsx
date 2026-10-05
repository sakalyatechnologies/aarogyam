import { Plus, Trash2 } from "lucide-react";
import type { ReactNode, SubmitEvent } from "react";

import type { SiteChoice, SitePhoto, WebsiteContent } from "@aarogyam/api-client";
import { formatFee } from "@aarogyam/site-kit";
import { Button, Checkbox, Field, Select, Switch, TextArea, TextInput } from "@sakalya/ui";

export interface ContentTabProps {
  content: WebsiteContent;
  doctors: readonly SiteChoice[];
  services: readonly SiteChoice[];
  photos: readonly SitePhoto[];
  /** Keeps the form's changes in the editor without saving them yet. */
  onChange: (content: WebsiteContent) => void;
  /** Saves the content as it is in the editor. */
  onSave: () => void;
  saving: boolean;
  /** Opens the file chooser for a doctor's portrait. */
  onPortrait: (doctorId: string) => void;
  errors: Record<string, string>;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="wb-section">
      <h3 className="wb-h3">{title}</h3>
      {hint !== undefined && <p className="wb-muted">{hint}</p>}
      {children}
    </section>
  );
}

function profileOf(content: WebsiteContent, id: string) {
  return content.doctors.find((d) => d.practitioner_id === id) ?? { practitioner_id: id, qualifications: "", bio: "", photo_id: null, hidden: false };
}

/** The content that isn't edited by clicking in the preview: contact, doctors, services, reviews and search text. */
export function ContentTab(props: ContentTabProps) {
  const { content: draft, doctors, services, photos, onChange, onSave, saving, onPortrait, errors } = props;
  const update = (change: (next: WebsiteContent) => void) => {
    const next = structuredClone(draft);
    change(next);
    onChange(next);
  };
  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave();
  };
  const setProfile = (id: string, patch: Partial<WebsiteContent["doctors"][number]>) => {
    update((next) => {
      const profile = next.doctors.find((d) => d.practitioner_id === id);
      if (profile === undefined) {
        next.doctors.push({ ...profileOf(next, id), ...patch });
      } else {
        Object.assign(profile, patch);
      }
    });
  };
  const err = (field: string) => errors[field];
  return (
    <form className="wb-stack" onSubmit={save}>
      <Section title="Contact and links" hint="Your phone and address come from Clinic profile. Add what is not there.">
        <Field label="WhatsApp number" hint="Patients tap it to chat. +91 is assumed." error={err("content.contact.whatsapp")}>
          <TextInput
            inputMode="tel"
            value={draft.contact.whatsapp}
            onChange={(event) => {
              update((n) => {
                n.contact.whatsapp = event.target.value;
              });
            }}
          />
        </Field>
        <Field label="Email shown on the site" error={err("content.contact.email")}>
          <TextInput
            type="email"
            value={draft.contact.email}
            onChange={(event) => {
              update((n) => {
                n.contact.email = event.target.value;
              });
            }}
          />
        </Field>
        <Field label="Map link" hint="Open your clinic in Google Maps, choose Share, and paste the link. Left empty, directions search your address." error={err("content.contact.map_url")}>
          <TextInput
            inputMode="url"
            placeholder="https://maps.app.goo.gl/..."
            value={draft.contact.map_url}
            onChange={(event) => {
              update((n) => {
                n.contact.map_url = event.target.value;
              });
            }}
          />
        </Field>
        {(["instagram", "facebook", "youtube"] as const).map((network) => (
          <Field key={network} label={`${network.charAt(0).toUpperCase()}${network.slice(1)} link`} error={err(`content.social.${network}`)}>
            <TextInput
              inputMode="url"
              placeholder="https://"
              value={draft.social[network]}
              onChange={(event) => {
                update((n) => {
                  n.social[network] = event.target.value;
                });
              }}
            />
          </Field>
        ))}
      </Section>

      <Section title="Doctors" hint="Names and specialties come from your doctors list. Add their degrees, a short introduction and a portrait.">
        {doctors.length === 0 && <p className="wb-muted">Add doctors in Settings, Chairs and doctors, and they appear here.</p>}
        {doctors.map((doctor) => {
          const profile = profileOf(draft, doctor.id);
          const portrait = photos.find((p) => p.id === profile.photo_id);
          return (
            <div key={doctor.id} className="wb-card-row">
              <div className="wb-row-head">
                <b>{doctor.name}</b>
                <Switch
                  label="Show on website"
                  checked={!profile.hidden}
                  onCheckedChange={(shown) => {
                    setProfile(doctor.id, { hidden: !shown });
                  }}
                />
              </div>
              <Field label="Qualifications" error={err("content.doctors.qualifications")}>
                <TextInput
                  placeholder="BDS, MDS (Orthodontics)"
                  value={profile.qualifications}
                  onChange={(event) => {
                    setProfile(doctor.id, { qualifications: event.target.value });
                  }}
                />
              </Field>
              <Field label="Introduction" error={err("content.doctors.bio")}>
                <TextArea
                  rows={3}
                  value={profile.bio}
                  onChange={(event) => {
                    setProfile(doctor.id, { bio: event.target.value });
                  }}
                />
              </Field>
              <div className="wb-inline">
                <Button
                  variant="secondary"
                  onClick={() => {
                    onPortrait(doctor.id);
                  }}
                >
                  {portrait === undefined ? "Add portrait" : "Change portrait"}
                </Button>
                {portrait !== undefined && <img className="wb-thumb" src={portrait.url} alt={portrait.alt ?? `Portrait of ${doctor.name}`} />}
              </div>
            </div>
          );
        })}
      </Section>

      <Section title="Services and fees" hint="Services come from your price list; medicines and products are left out. Choose what to show.">
        <Switch
          label="Show fees"
          hint="Patients see the price next to each service."
          checked={draft.services.show_fees}
          onCheckedChange={(shown) => {
            update((n) => {
              n.services.show_fees = shown;
            });
          }}
        />
        {services.length === 0 && <p className="wb-muted">Add services in Settings, Price list, and they appear here.</p>}
        <ul className="wb-service-list">
          {services.map((service) => {
            const hidden = draft.services.hidden.includes(service.id);
            const note = draft.services.notes.find((n) => n.price_item_id === service.id)?.description ?? "";
            return (
              <li key={service.id}>
                <Checkbox
                  label={
                    <>
                      {service.name}
                      {service.fee_paise != null && <span className="wb-muted"> · {formatFee(service.fee_paise)}</span>}
                    </>
                  }
                  checked={!hidden}
                  onChange={(event) => {
                    const shown = event.target.checked;
                    update((n) => {
                      n.services.hidden = shown ? n.services.hidden.filter((id) => id !== service.id) : [...n.services.hidden, service.id];
                    });
                  }}
                />
                {!hidden && (
                  <TextInput
                    aria-label={`Short note for ${service.name}`}
                    placeholder="A short note (optional)"
                    value={note}
                    onChange={(event) => {
                      const description = event.target.value;
                      update((n) => {
                        const existing = n.services.notes.find((x) => x.price_item_id === service.id);
                        if (existing === undefined) {
                          n.services.notes.push({ price_item_id: service.id, description });
                        } else {
                          existing.description = description;
                        }
                      });
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Reviews" hint="Add kind words your patients have given you. Use a first name and initial. Up to 12.">
        {draft.reviews.map((review, index) => (
          <div key={`${String(index)}-${review.name}`} className="wb-card-row">
            <div className="wb-grid2">
              <Field label="Name" error={err("content.reviews.name")}>
                <TextInput
                  value={review.name}
                  onChange={(event) => {
                    update((n) => {
                      const target = n.reviews[index];
                      if (target !== undefined) target.name = event.target.value;
                    });
                  }}
                />
              </Field>
              <Field label="Stars">
                <Select
                  value={String(review.rating)}
                  options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${String(n)} stars` }))}
                  onValueChange={(value) => {
                    update((n) => {
                      const target = n.reviews[index];
                      if (target !== undefined) target.rating = Number(value);
                    });
                  }}
                />
              </Field>
            </div>
            <Field label="Review" error={err("content.reviews.text")}>
              <TextArea
                rows={2}
                value={review.text}
                onChange={(event) => {
                  update((n) => {
                    const target = n.reviews[index];
                    if (target !== undefined) target.text = event.target.value;
                  });
                }}
              />
            </Field>
            <Button
              variant="ghost"
              icon={<Trash2 size={16} aria-hidden="true" />}
              onClick={() => {
                update((n) => {
                  n.reviews.splice(index, 1);
                });
              }}
            >
              Remove review
            </Button>
          </div>
        ))}
        {err("content.reviews") !== undefined && <p className="wb-error">{err("content.reviews")}</p>}
        <Button
          variant="secondary"
          icon={<Plus size={16} aria-hidden="true" />}
          disabled={draft.reviews.length >= 12}
          onClick={() => {
            update((n) => {
              n.reviews.push({ name: "", rating: 5, text: "" });
            });
          }}
        >
          Add a review
        </Button>
      </Section>

      <Section title="Top of the home page and search" hint="Clear wording helps people find you on Google.">
        <Field label="Booking button label" hint="Left empty, it says Book an appointment." error={err("content.hero.cta_label")}>
          <TextInput
            value={draft.hero.cta_label}
            onChange={(event) => {
              update((n) => {
                n.hero.cta_label = event.target.value;
              });
            }}
          />
        </Field>
        <Field label="Page title for search results" hint="Up to 70 characters." error={err("content.seo.title")}>
          <TextInput
            value={draft.seo.title}
            onChange={(event) => {
              update((n) => {
                n.seo.title = event.target.value;
              });
            }}
          />
        </Field>
        <Field label="Description for search results" hint="Up to 170 characters." error={err("content.seo.description")}>
          <TextArea
            rows={2}
            value={draft.seo.description}
            onChange={(event) => {
              update((n) => {
                n.seo.description = event.target.value;
              });
            }}
          />
        </Field>
      </Section>

      <div className="wb-sticky-save">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
