import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, Bell, FileText, LogOut, Plus } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { randomUuid, unwrap, type ChatMessage, type ConversationItem } from "@aarogyam/api-client";
import { Pills, ChatThread, Composer, type ChatMessage as ThreadMessage } from "@sakalya/ui";

import { Empty, MkCard } from "../../../components/mk/index.js";
import { useClinic } from "../../../clinic.js";
import { POLL_MS, useColleagues, useConversations, why } from "./queries.js";

/** "99+" above 99, as the API asks. */
const badge = (n: number): string => (n > 99 ? "99+" : String(n));

function titleOf(c: ConversationItem): string {
  return c.kind === "direct" ? (c.with?.name ?? "Direct chat") : c.kind === "channel" ? (c.title ?? "Everyone") : (c.title ?? "Group chat");
}

const ATTACHABLE = ["image/jpeg", "image/png", "application/pdf"];
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const kb = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`);

export function ChatTab() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  const conversations = useConversations(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // The clinic-wide channel comes first; the order from the server holds for the rest.
  const items = useMemo(() => {
    const all = conversations.data?.items ?? [];
    return [...all.filter((c) => c.kind === "channel"), ...all.filter((c) => c.kind !== "channel")];
  }, [conversations.data]);
  const open = items.find((c) => c.id === openId) ?? null;
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ["messages", access.org_id, "conversations"] }), [queryClient, access.org_id]);

  const mute = useMutation({
    mutationFn: ({ id, muted }: { id: string; muted: boolean }) => unwrap(api.muteConversation(id, muted)),
    onSuccess: refresh,
  });
  const leave = useMutation({
    mutationFn: (id: string) => unwrap(api.leaveConversation(id)),
    onSuccess: () => {
      setOpenId(null);
      return refresh();
    },
  });

  return (
    <div className="ms-chat">
      <MkCard
        title="Conversations"
        action={
          <button type="button" className="ms-link" aria-expanded={creating} onClick={() => { setCreating((v) => !v); }}>
            <Plus aria-hidden="true" size={14} /> New chat
          </button>
        }
      >
        {creating ? (
          <NewChat
            onDone={(id) => {
              setCreating(false);
              setOpenId(id);
              void refresh();
            }}
            onCancel={() => { setCreating(false); }}
          />
        ) : null}
        {conversations.isPending ? <p className="mk-hint">Loading conversations…</p> : null}
        {conversations.isError ? (
          <p role="alert" className="ms-error">
            Couldn't load your conversations. {why(conversations.error)}{" "}
            <button type="button" className="ms-link" onClick={() => { void conversations.refetch(); }}>
              Try again
            </button>
          </p>
        ) : null}
        {conversations.isSuccess && items.length === 0 ? <Empty title="No conversations yet">Start a chat with a colleague or a group.</Empty> : null}
        <ul className="ms-convs" aria-label="Conversations">
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" className="ms-conv" aria-current={c.id === openId ? "true" : undefined} onClick={() => { setOpenId(c.id); }}>
                <span className="ms-conv-title">{titleOf(c)}</span>
                {c.muted ? <BellOff aria-label="Muted" size={13} /> : null}
                {c.unread > 0 ? (
                  <span className="ms-unread" aria-label={`${String(c.unread)} unread`}>
                    {badge(c.unread)}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </MkCard>

      {open === null ? (
        <MkCard title="Staff chat">
          <Empty title="Pick a conversation">Choose one on the left, or start a new chat.</Empty>
        </MkCard>
      ) : (
        <Thread
          key={open.id}
          conversation={open}
          onMute={() => { mute.mutate({ id: open.id, muted: !open.muted }); }}
          onLeave={() => { leave.mutate(open.id); }}
          onRead={refresh}
          error={mute.error ?? leave.error}
        />
      )}
    </div>
  );
}

function Thread({
  conversation,
  onMute,
  onLeave,
  onRead,
  error,
}: {
  conversation: ConversationItem;
  onMute: () => void;
  onLeave: () => void;
  onRead: () => Promise<unknown>;
  error: unknown;
}) {
  const { api, session, access, can } = useClinic();
  const queryClient = useQueryClient();
  const canNotice = can("chat.notice");
  const fileInput = useRef<HTMLInputElement>(null);
  const me: string = session.membership.id;
  // The first page comes from the query; what arrives later (polls, our own sends) is kept beside it and merged.
  const [later, setLater] = useState<ChatMessage[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // A chosen file waits here until Send, so what is typed goes with it as its caption.
  const [staged, setStaged] = useState<File | null>(null);
  const id = conversation.id;

  const first = useQuery({
    queryKey: ["messages", "thread", id],
    queryFn: ({ signal }) => unwrap(api.listChatMessages(id, undefined, { signal })),
    staleTime: 0,
    gcTime: 0,
  });
  // The pinned notice comes with the conversation; it is asked again when a notice arrives or is posted.
  const detail = useQuery({
    queryKey: ["messages", access.org_id, "conversation", id],
    queryFn: ({ signal }) => unwrap(api.getConversation(id, { signal })),
    staleTime: 0,
    gcTime: 0,
  });
  const refreshNotice = useCallback(() => queryClient.invalidateQueries({ queryKey: ["messages", access.org_id, "conversation", id] }), [queryClient, access.org_id, id]);
  const messages = useMemo<ChatMessage[]>(() => {
    const byId = new Map<string, ChatMessage>();
    for (const m of [...(first.data?.items ?? []), ...later]) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }, [first.data, later]);
  const merge = useCallback((incoming: readonly ChatMessage[]) => {
    if (incoming.some((m) => m.is_notice === true)) void refreshNotice();
    setLater((now) => {
      const known = new Set(now.map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      return fresh.length === 0 ? now : [...now, ...fresh];
    });
  }, [refreshNotice]);

  // News arrives by polling, from the newest message this chat has, only while the chat is open.
  const newest = useRef<string | undefined>(undefined);
  const latest = messages.at(-1)?.id;
  useEffect(() => {
    newest.current = latest;
  }, [latest]);
  const loaded = first.isSuccess;
  useEffect(() => {
    if (!loaded) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      // Only while the tab is in front; the next tick after it returns catches up.
      if (document.visibilityState === "hidden") return;
      const after = newest.current;
      void api.listChatMessages(id, after === undefined ? undefined : { after }, { signal: controller.signal }).then((result) => {
        if (result.ok) merge(result.value.items);
      });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [api, id, loaded, merge]);

  // Looking at the newest message reads it. The pointer only moves forward, so it is sent once per message.
  const lastRead = useRef(conversation.last_read_message_id ?? "");
  useEffect(() => {
    if (latest === undefined || latest <= lastRead.current) return;
    lastRead.current = latest;
    void api.markConversationRead(id, latest).then(() => onRead());
  }, [api, id, latest, onRead]);

  const post = useMutation({
    mutationFn: ({ body, notice }: { body: string; notice: boolean }) =>
      unwrap(api.postChatMessage(id, { body, client_id: randomUuid(), ...(notice && canNotice ? { is_notice: true } : {}) })),
    onSuccess: (sent) => {
      setSendError(null);
      merge([sent]);
    },
    onError: (thrown) => {
      setSendError(why(thrown));
    },
  });

  const attach = useMutation({
    mutationFn: ({ file, caption }: { file: File; caption: string }) => {
      const form = new FormData();
      form.set("client_id", randomUuid());
      form.set("file", file);
      if (caption !== "") form.set("body", caption);
      return unwrap(api.postChatAttachment(id, form));
    },
    onSuccess: (sent) => {
      setSendError(null);
      setStaged(null);
      merge([sent]);
    },
    onError: (thrown) => {
      setSendError(why(thrown));
    },
  });
  const chooseFile = (file: File | undefined) => {
    if (file === undefined) return;
    if (!ATTACHABLE.includes(file.type)) {
      setSendError("Attach a JPEG, PNG or PDF file.");
    } else if (file.size > MAX_FILE_BYTES) {
      setSendError("That file is over 5 MB.");
    } else {
      setSendError(null);
      setStaged(file);
    }
  };
  const download = useMutation({
    mutationFn: async (fileId: string) => (await unwrap(api.getChatAttachmentDownloadLink(fileId))).url,
    onSuccess: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (thrown) => {
      setSendError(why(thrown));
    },
  });
  const files = messages.filter((m) => !m.deleted && m.attachment != null);

  const { timezone } = session.clinic;
  const shown = useMemo<ThreadMessage[]>(
    () =>
      messages.map((m) => ({
        id: m.id,
        author: m.author_name ?? "Colleague",
        text: m.deleted ? "This message was deleted." : messageText(m),
        ...(m.is_notice === true ? { flagged: true } : {}),
        time: timeLabel(m.created_at, timezone),
        mine: m.author_membership_id === me,
      })),
    [messages, me, timezone],
  );
  const title = titleOf(conversation);
  const group = conversation.kind === "group";
  const notice = detail.data?.pinned_notice;

  return (
    <MkCard
      title={title}
      hint={group ? "Group chat" : conversation.kind === "channel" ? "Channel for the whole clinic" : "Direct chat"}
      action={
        <span className="ms-actions">
          <button type="button" className="ms-link" aria-pressed={conversation.muted} onClick={onMute}>
            {conversation.muted ? <Bell aria-hidden="true" size={14} /> : <BellOff aria-hidden="true" size={14} />} {conversation.muted ? "Unmute" : "Mute"}
          </button>
          {group ? (
            <button type="button" className="ms-link" onClick={() => { setConfirmLeave(true); }}>
              <LogOut aria-hidden="true" size={14} /> Leave
            </button>
          ) : null}
        </span>
      }
    >
      {confirmLeave ? (
        <p className="ms-confirm" role="alertdialog" aria-label={`Leave ${title}`}>
          Leave {title}? You won't see new messages.{" "}
          <button type="button" className="ms-link ms-danger" onClick={onLeave}>
            Leave chat
          </button>{" "}
          <button type="button" className="ms-link" onClick={() => { setConfirmLeave(false); }}>
            Stay
          </button>
        </p>
      ) : null}
      {error != null ? <p role="alert" className="ms-error">{why(error)}</p> : null}
      {first.isPending ? <p className="mk-hint">Loading messages…</p> : null}
      {first.isError ? (
        <p role="alert" className="ms-error">
          Couldn't load this chat. {why(first.error)}{" "}
          <button type="button" className="ms-link" onClick={() => { void first.refetch(); }}>
            Try again
          </button>
        </p>
      ) : null}
      {loaded ? (
        <ChatThread
          label={`Messages in ${title}`}
          messages={shown}
          pinned={notice == null ? undefined : { author: notice.author_name ?? "Colleague", text: notice.body ?? "", label: "Pinned notice" }}
          emptyText="No messages yet. Say hello."
          height={360}
          labels={{ flagged: "Notice", you: "You" }}
        />
      ) : null}
      {files.length === 0 ? null : (
        <ul className="ms-files" aria-label="Files in this chat">
          {files.map((m) => (
            <li key={m.id}>
              <FileText aria-hidden="true" size={14} /> {m.attachment?.file_name ?? "Attachment"} ({kb(m.attachment?.size_bytes ?? 0)}) from {m.author_name ?? "a colleague"}{" "}
              <button type="button" className="ms-link" disabled={download.isPending} aria-label={`Download ${m.attachment?.file_name ?? "attachment"}`} onClick={() => { if (m.attachment != null) download.mutate(m.attachment.id); }}>
                Download
              </button>
            </li>
          ))}
        </ul>
      )}
      {sendError !== null ? <p role="alert" className="ms-error">{sendError}</p> : null}
      {staged === null ? null : (
        <p className="ms-staged" role="status">
          <FileText aria-hidden="true" size={14} /> {staged.name} ({kb(staged.size)}). Type a caption and send, or{" "}
          <button type="button" className="ms-link" disabled={attach.isPending} onClick={() => { attach.mutate({ file: staged, caption: "" }); }}>
            Send without caption
          </button>{" "}
          <button type="button" className="ms-link" disabled={attach.isPending} aria-label={`Remove ${staged.name}`} onClick={() => { setStaged(null); }}>
            Remove
          </button>
        </p>
      )}
      <Composer
        onSend={(text, options) => {
          if (staged === null) post.mutate({ body: text, notice: options.flagged });
          else attach.mutate({ file: staged, caption: text });
        }}
        {...(canNotice ? { flagOption: { label: "Post as notice", hint: "Pinned at the top for everyone in this chat" } } : {})}
        onAttach={() => { fileInput.current?.click(); }}
        disabled={!loaded}
        maxLength={4000}
        placeholder={`Message ${title}`}
        labels={{ message: `Message ${title}`, send: "Send message" }}
        className="ms-composer"
      />
      <input
        ref={fileInput}
        type="file"
        hidden
        accept="image/jpeg,image/png,application/pdf"
        aria-label="Choose a file to attach"
        onChange={(event) => {
          chooseFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </MkCard>
  );
}

/** The thread line: the text, and for a file its name before any caption. */
function messageText(m: ChatMessage): string {
  if (m.attachment == null) return m.body ?? "This message was deleted.";
  const sent = `Sent a file: ${m.attachment.file_name ?? "attachment"}`;
  return m.body == null ? sent : `${sent}. ${m.body}`;
}

/** "14:05" today, otherwise "3 Oct", in the clinic's time zone. */
function timeLabel(iso: string, timeZone: string): string {
  const at = new Date(iso);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(d);
  return day(at) === day(new Date())
    ? new Intl.DateTimeFormat("en-IN", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at)
    : new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short" }).format(at);
}

function NewChat({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const { api } = useClinic();
  const people = useColleagues(true);
  const [kind, setKind] = useState<"direct" | "group">("direct");
  const [chosen, setChosen] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const titleId = useId();
  const start = useMutation({
    mutationFn: () =>
      unwrap(
        api.startConversation(kind === "direct" ? { kind, membership_id: chosen[0] ?? "" } : { kind, title: title.trim(), member_ids: chosen }),
      ),
    onSuccess: (made) => {
      onDone(made.id);
    },
  });
  const ready = kind === "direct" ? chosen.length === 1 : chosen.length > 0 && title.trim() !== "";
  const toggle = (id: string) => {
    setChosen((now) => (kind === "direct" ? [id] : now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  };

  return (
    <form
      className="ms-new"
      aria-label="New chat"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) start.mutate();
      }}
    >
      <Pills
        label="Kind of chat"
        size="sm"
        options={[
          { value: "direct", label: "Direct" },
          { value: "group", label: "Group" },
        ]}
        value={kind}
        onValueChange={(next) => {
          setKind(next);
          setChosen([]);
        }}
      />
      {kind === "group" ? (
        <>
          <label className="mk-flabel" htmlFor={titleId}>
            Group name
          </label>
          <input id={titleId} className="mk-tin" maxLength={80} value={title} onChange={(e) => { setTitle(e.target.value); }} />
        </>
      ) : null}
      <fieldset className="ms-people">
        <legend className="mk-flabel">{kind === "direct" ? "Colleague" : "Members"}</legend>
        {people.isPending ? <p className="mk-hint">Loading colleagues…</p> : null}
        {people.isError ? <p role="alert" className="ms-error">Couldn't load colleagues. {why(people.error)}</p> : null}
        {people.isSuccess && people.data.length === 0 ? <p className="mk-hint">No colleagues to chat with yet.</p> : null}
        {people.data?.map((p) => (
          <label key={p.id} className="ms-person">
            <input type={kind === "direct" ? "radio" : "checkbox"} name="colleague" checked={chosen.includes(p.id)} onChange={() => { toggle(p.id); }} /> {p.name}
          </label>
        ))}
      </fieldset>
      {start.isError ? <p role="alert" className="ms-error">{why(start.error)}</p> : null}
      <div className="ms-actions">
        <button type="submit" className="mk-btn mk-btn-primary" disabled={!ready || start.isPending}>
          {start.isPending ? "Starting…" : "Start chat"}
        </button>
        <button type="button" className="ms-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
