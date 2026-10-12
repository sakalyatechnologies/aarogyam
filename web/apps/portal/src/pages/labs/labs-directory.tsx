import { Mail, MessageCircle, Pencil, Phone, Plus } from "lucide-react";
import { useState } from "react";

import type { LabContact, LabOrder, LabVendor } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Button, Drawer } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { EmptyState, SkeletonList, Tag } from "../../components/mk/index.js";
import { ContactDialog, KIND_LABEL, LabDialog } from "./lab-forms.js";
import { PaymentsPanel } from "./payments-panel.js";
import { useLabVendors } from "./queries.js";
import { telLink, waLink } from "./stages.js";

/** The labs and the people at each: call, WhatsApp, email, edit. Opening a lab shows its details and payments. */
export function LabsDirectory({ openOrders, adding, onAdd, onAddClose }: { openOrders: readonly LabOrder[]; adding: boolean; onAdd: () => void; onAddClose: () => void }) {
  const { can } = useClinic();
  const canWrite = can("labs.write");
  const vendors = useLabVendors();
  const [editing, setEditing] = useState<LabVendor>();
  const [contactFor, setContactFor] = useState<{ lab: LabVendor; contact: LabContact | undefined }>();
  const [detail, setDetail] = useState<string>();
  const labs = vendors.data?.items ?? [];
  const shown = labs.find((l) => l.id === detail);

  if (vendors.isPending) return <SkeletonList label="Loading labs" />;
  if (vendors.isError) {
    return (
      <ApiErrorNotice
        title="Couldn't load the labs"
        error={vendors.error}
        onRetry={() => {
          void vendors.refetch();
        }}
      />
    );
  }
  return (
    <>
      {labs.length === 0 ? (
        <EmptyState
          art="lab"
          title="No labs yet"
          description={canWrite ? "Add the labs you send work to, with the people there." : "Ask someone who manages labs to add them."}
          action={
            canWrite ? (
              <Button onClick={onAdd}>Add a lab</Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="lb-labs" aria-label="Labs">
          {labs.map((lab) => {
            const active = openOrders.filter((o) => o.vendor_id === lab.id).length;
            return (
              <li key={lab.id} className="lb-card">
                <div className="lb-card-h">
                  <div className="lb-card-t">
                    <button
                      type="button"
                      className="lb-open"
                      onClick={() => {
                        setDetail(lab.id);
                      }}
                    >
                      {lab.name}
                    </button>
                    <span className="lb-sub">
                      {KIND_LABEL[lab.kind]}
                      {lab.address == null ? "" : ` · ${lab.address}`}
                    </span>
                  </div>
                  <Tag tone={active > 0 ? "next" : "neutral"}>{active} active</Tag>
                </div>
                {lab.note == null ? null : <p className="lb-note">{lab.note}</p>}
                {lab.contacts.length === 0 ? (
                  <p className="lb-sub">No contacts yet.</p>
                ) : (
                  <ul className="lb-contacts" aria-label={`People at ${lab.name}`}>
                    {lab.contacts.map((contact) => (
                      <ContactRow
                        key={contact.id}
                        contact={contact}
                        onEdit={
                          canWrite
                            ? () => {
                                setContactFor({ lab, contact });
                              }
                            : undefined
                        }
                      />
                    ))}
                  </ul>
                )}
                <div className="lb-actions">
                  {lab.phone == null ? null : (
                    <a className="lb-btn" href={telLink(lab.phone)} aria-label={`Call ${lab.name}`}>
                      <Phone aria-hidden="true" />
                      Call lab
                    </a>
                  )}
                  {canWrite ? (
                    <>
                      <button
                        type="button"
                        className="lb-btn"
                        onClick={() => {
                          setContactFor({ lab, contact: undefined });
                        }}
                        aria-label={`Add a contact at ${lab.name}`}
                      >
                        <Plus aria-hidden="true" />
                        Contact
                      </button>
                      <button
                        type="button"
                        className="lb-btn"
                        onClick={() => {
                          setEditing(lab);
                        }}
                        aria-label={`Edit ${lab.name}`}
                      >
                        <Pencil aria-hidden="true" />
                        Edit
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {adding || editing !== undefined ? (
        <LabDialog
          key={editing?.id ?? "new"}
          lab={editing}
          open
          onClose={() => {
            setEditing(undefined);
            onAddClose();
          }}
        />
      ) : null}
      {contactFor === undefined ? null : (
        <ContactDialog
          key={contactFor.contact?.id ?? "new"}
          lab={contactFor.lab}
          contact={contactFor.contact}
          open
          onClose={() => {
            setContactFor(undefined);
          }}
        />
      )}
      <Drawer
        open={shown !== undefined}
        onOpenChange={(next) => {
          if (!next) setDetail(undefined);
        }}
        title={shown?.name ?? "Lab"}
        description={shown === undefined ? undefined : KIND_LABEL[shown.kind]}
        size="lg"
      >
        {shown === undefined ? null : <LabDetail lab={shown} />}
      </Drawer>
    </>
  );
}

function ContactRow({ contact, onEdit }: { contact: LabContact; onEdit: (() => void) | undefined }) {
  return (
    <li className="lb-contact">
      <div>
        <b>{contact.name}</b>
        {contact.role == null ? null : <span className="lb-sub"> · {contact.role}</span>}
        <span className="lb-sub">
          {" "}
          · prefers {contact.preferred_channel === "phone" ? "a call" : contact.preferred_channel}
        </span>
      </div>
      <div className="lb-icons">
        {contact.phone == null ? null : (
          <a className="lb-iconbtn" href={telLink(contact.phone)} aria-label={`Call ${contact.name}`}>
            <Phone aria-hidden="true" size={15} />
          </a>
        )}
        {contact.phone != null && contact.whatsapp ? (
          <a className="lb-iconbtn" href={waLink(contact.phone, `Hi ${contact.name.split(" ")[0] ?? ""}`)} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${contact.name}`}>
            <MessageCircle aria-hidden="true" size={15} />
          </a>
        ) : null}
        {contact.email == null ? null : (
          <a className="lb-iconbtn" href={`mailto:${contact.email}`} aria-label={`Email ${contact.name}`}>
            <Mail aria-hidden="true" size={15} />
          </a>
        )}
        {onEdit === undefined ? null : (
          <button type="button" className="lb-iconbtn" onClick={onEdit} aria-label={`Edit ${contact.name}`}>
            <Pencil aria-hidden="true" size={15} />
          </button>
        )}
      </div>
    </li>
  );
}

function LabDetail({ lab }: { lab: LabVendor }) {
  const { can } = useClinic();
  const payments = can("expenses.write") && can("finance.view");
  return (
    <div className="lb-drawer">
      <section aria-labelledby="lb-l-info">
        <h3 id="lb-l-info" className="mk-flabel">
          Details
        </h3>
        <p className="lb-sub">
          {[lab.phone, lab.email, lab.address].filter((part) => part != null && part !== "").join(" · ") || "No contact details yet."}
        </p>
        {lab.note == null ? null : <p className="lb-note">{lab.note}</p>}
      </section>
      <section aria-labelledby="lb-l-people">
        <h3 id="lb-l-people" className="mk-flabel">
          People
        </h3>
        {lab.contacts.length === 0 ? (
          <p className="lb-sub">No contacts yet.</p>
        ) : (
          <ul className="lb-contacts" aria-label={`People at ${lab.name}`}>
            {lab.contacts.map((contact) => (
              <ContactRow key={contact.id} contact={contact} onEdit={undefined} />
            ))}
          </ul>
        )}
      </section>
      {payments ? <PaymentsPanel vendorId={lab.id} /> : null}
    </div>
  );
}
