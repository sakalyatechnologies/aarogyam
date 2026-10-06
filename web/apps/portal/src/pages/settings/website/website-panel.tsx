import { Globe } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { apiErrorOf, type SitePhoto, type WebsiteChanges, type WebsiteContent, type WebsiteSettings } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import type { EditApi, PhotoKind } from "@aarogyam/site-kit";
import { Button, Pill, Tabs, useToast, type TabItem } from "@sakalya/ui";

import { ContentTab } from "./content-tab.js";
import { DesignTab, type Design } from "./design-tab.js";
import { DomainTab } from "./domain-tab.js";
import { applyText, overlay } from "./edit-paths.js";
import { PicturesTab } from "./pictures-tab.js";
import { SitePreview } from "./preview.js";
import { useDeletePhoto, useDescribePhoto, useUpdateWebsite, useUploadPhoto, useWebsite } from "./queries.js";
import "./website.css";
import { SkeletonRows } from "../../../components/skeleton-rows.js";

/** Settings, Website: choose a design, edit the content in a live preview, and publish. */
export function WebsitePanel() {
  const website = useWebsite();
  if (website.isPending) {
    return <SkeletonRows count={4} label="Loading the website" />;
  }
  if (website.isError) {
    return <ApiErrorNotice title="Couldn't load the website settings" error={website.error} onRetry={() => void website.refetch()} />;
  }
  return <Builder settings={website.data} />;
}

/** The API names the field before a colon: `content.hero.headline: is too long`. */
function fieldErrors(message: string): Record<string, string> {
  const [field, ...rest] = message.split(": ");
  return rest.length > 0 && field !== undefined && field.includes(".") ? { [field]: rest.join(": ") } : {};
}

function Builder({ settings }: { settings: WebsiteSettings }) {
  const toast = useToast();
  const update = useUpdateWebsite();
  const upload = useUploadPhoto();
  const describe = useDescribePhoto();
  const remove = useDeletePhoto();
  const [content, setContent] = useState<WebsiteContent>(settings.content);
  const [design, setDesign] = useState<Design>({ layout: settings.layout, template: settings.template, palette: settings.palette, fonts: settings.fonts });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const version = useRef(0);
  const contentRef = useRef(content);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const target = useRef<{ kind: PhotoKind; doctorId?: string } | null>(null);

  const fail = useCallback(
    (thrown: unknown, fallback: string) => {
      const message = apiErrorOf(thrown)?.message ?? fallback;
      toast.show({ title: message, tone: "danger" });
      return message;
    },
    [toast],
  );

  /** Sends changes; text the server cleaned replaces the draft unless the owner has typed since. */
  const save = useCallback(
    (changes: WebsiteChanges) => {
      version.current += 1;
      const sent = version.current;
      return update.mutateAsync(changes).then(
        (saved) => {
          setErrors({});
          if (version.current === sent) {
            contentRef.current = saved.content;
            setContent(saved.content);
          }
          return saved;
        },
        (thrown: unknown) => {
          setErrors(fieldErrors(fail(thrown, "Couldn't save that. Please try again.")));
          throw thrown;
        },
      );
    },
    [update, fail],
  );

  const changeContent = useCallback((next: WebsiteContent) => {
    contentRef.current = next;
    setContent(next);
  }, []);

  const saveContent = useCallback(
    (next: WebsiteContent) => {
      changeContent(next);
      void save({ content: next }).catch(() => undefined);
    },
    [changeContent, save],
  );

  const changeDesign = (changes: Partial<Design>) => {
    setDesign((previous) => ({ ...previous, ...changes }));
    void save(changes).catch(() => {
      setDesign({ layout: settings.layout, template: settings.template, palette: settings.palette, fonts: settings.fonts });
    });
  };

  const site = useMemo(() => ({ ...overlay(settings.preview, content), design: { ...settings.preview.design, ...design } }), [settings.preview, content, design]);

  const uploadFiles = async (files: readonly File[], kind: SitePhoto["kind"], doctorId?: string) => {
    for (const file of kind === "gallery" ? files : files.slice(0, 1)) {
      try {
        const photo = await upload.mutateAsync({ file, kind });
        if (doctorId !== undefined) {
          const next = structuredClone(contentRef.current);
          const profile = next.doctors.find((d) => d.practitioner_id === doctorId);
          if (profile === undefined) {
            next.doctors.push({ practitioner_id: doctorId, qualifications: "", bio: "", photo_id: photo.id, hidden: false });
          } else {
            profile.photo_id = photo.id;
          }
          saveContent(next);
        }
      } catch (thrown) {
        fail(thrown, "Couldn't upload that picture. Use a JPEG, PNG or WebP under 5 MB.");
      }
    }
    if (files.length > 0) {
      toast.show({ title: kind === "gallery" && files.length > 1 ? "Pictures added" : "Picture added", tone: "success" });
    }
  };

  const choosePicture = (kind: PhotoKind, doctorId?: string) => {
    target.current = doctorId === undefined ? { kind } : { kind, doctorId };
    fileInput.current?.click();
  };

  const edit: EditApi = {
    setText: (path, value) => {
      const next = applyText(contentRef.current, site, path, value);
      if (next !== null) {
        saveContent(next);
      }
    },
    pickPhoto: (kind) => {
      choosePicture(kind);
    },
  };

  const publish = (published: boolean) => {
    save({ published }).then(
      () => {
        toast.show({
          title: published ? "Published. Your website goes live on your address once hosting is connected." : "Website taken down",
          tone: "success",
        });
      },
      () => undefined,
    );
  };

  const items: TabItem[] = [
    { value: "design", label: "Design", content: <DesignTab design={design} onChange={changeDesign} /> },
    {
      value: "content",
      label: "Content",
      content: (
        <ContentTab
          content={content}
          doctors={settings.doctors}
          services={settings.services}
          photos={settings.photos}
          onChange={changeContent}
          onSave={() => {
            void save({ content: contentRef.current }).then(() => {
              toast.show({ title: "Content saved", tone: "success" });
            }, () => undefined);
          }}
          saving={update.isPending}
          onPortrait={(doctorId) => {
            choosePicture("doctor", doctorId);
          }}
          errors={errors}
        />
      ),
    },
    {
      value: "pictures",
      label: "Pictures",
      content: (
        <PicturesTab
          photos={settings.photos.filter((p) => p.kind !== "doctor")}
          busy={upload.isPending}
          onUpload={(files, kind) => {
            void uploadFiles(files, kind);
          }}
          onDescribe={(photo, alt) => {
            describe.mutate({ id: photo.id, changes: { alt } }, { onError: (thrown) => fail(thrown, "Couldn't save the description.") });
          }}
          onDelete={(photo) => {
            remove.mutate(photo.id, {
              onSuccess: () => {
                toast.show({ title: "Picture removed", tone: "success" });
              },
              onError: (thrown) => fail(thrown, "Couldn't remove the picture."),
            });
          }}
        />
      ),
    },
    {
      value: "domain",
      label: "Domain",
      content: (
        <DomainTab
          domain={settings.domain}
          saving={update.isPending}
          onSave={(domain) =>
            save({ custom_domain: domain }).then((saved) => {
              toast.show({ title: domain === "" ? "Domain removed" : `Domain saved: ${saved.domain.custom_domain ?? ""}`, tone: "success" });
            })
          }
        />
      ),
    },
  ];

  const state = update.isPending ? "Saving…" : update.isError ? "Not saved" : "All changes saved";
  return (
    <div className="wb">
      <input
        ref={fileInput}
        type="file"
        className="mk-sr"
        tabIndex={-1}
        aria-hidden="true"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          const chosen = target.current;
          target.current = null;
          if (files.length > 0 && chosen !== null) {
            void uploadFiles(files, chosen.kind, chosen.doctorId);
          }
        }}
      />
      <div className="wb-top">
        <div>
          <h2 className="wb-title">
            <Globe size={18} aria-hidden="true" /> Your website
          </h2>
          <p className="wb-muted">
            {settings.published ? "Published" : "Not published yet"} · {settings.domain.custom_domain ?? settings.domain.default_address}
          </p>
        </div>
        <div className="wb-top-actions">
          <span className="wb-state" role="status">
            {state}
          </span>
          <Pill tone={settings.published ? "success" : "neutral"}>{settings.published ? "Published" : "Draft"}</Pill>
          {settings.published ? (
            <Button
              variant="secondary"
              disabled={update.isPending}
              onClick={() => {
                publish(false);
              }}
            >
              Take down
            </Button>
          ) : (
            <Button
              disabled={update.isPending}
              onClick={() => {
                publish(true);
              }}
            >
              Publish
            </Button>
          )}
        </div>
      </div>
      <div className="wb-body">
        <div className="wb-controls">
          <Tabs label="Website settings" items={items} />
        </div>
        <SitePreview site={site} edit={edit} />
      </div>
    </div>
  );
}
