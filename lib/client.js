/**
 * dsh-conversation-links — Client half.
 *
 * Three ways to move conversation records between sessions:
 *   1. Drag a Session row out of the sidebar and drop it on a composer card.
 *      The drop inserts a canonical `@[label](dsh-session:<base64url>)` chip for
 *      the dragged Session, so the shipped session-reference resolver snapshots
 *      that conversation on send.
 *   2. The composer "link" button opens the record picker for the current
 *      Session.
 *   3. The sidebar row action opens the picker with that Session preselected as
 *      the source, then inserts the checked messages into the target Session.
 *
 * Everything is read through the Session runtime (`sessions.retain()` +
 * `eventSource`) and written through the composer input shell
 * (`conversation.input.shell(id).actions`), so no Host route is required.
 */
window.__ModuleLoader__.load({
  id: "dsh-conversation-links",
  factory(require) {
    "use strict";

    const React = require("react");
    const h = React.createElement;

    let primitives = null;
    try {
      primitives = require("@deepseek-ai/dsh-client-ui-primitives") || null;
    } catch (error) {
      primitives = null;
    }

    const NAME = "conversation-links";
    const NS = "conversation-links";
    const RETAIN_SOURCE = "conversation-links";
    const SESSION_URI_PREFIX = "dsh-session:";
    const PREVIEW_CHARS = 400;
    const TOAST_MS = 2600;

    /* ------------------------------------------------------------------ */
    /* locale                                                              */
    /* ------------------------------------------------------------------ */

    const zh = {
      pickerTitle: "插入对话记录",
      pickerHint: "从左侧选择一段对话，勾选其中的消息，再插入到目标对话。",
      sourceLabel: "来源对话",
      targetLabel: "插入到",
      searchSessions: "搜索对话…",
      noSessions: "没有匹配的对话",
      pickSession: "选择一段对话",
      loading: "正在读取…",
      noMessages: "这段对话里没有可引用的文本消息",
      loadOlder: "加载更早的消息",
      noMore: "已到最早",
      selectAll: "全选",
      clearAll: "清空",
      selectedCount: "已选 {count} 条",
      insert: "插入",
      cancel: "取消",
      close: "关闭",
      needMessages: "请先勾选要插入的消息",
      inserted: "已插入 {count} 条消息",
      insertedMention: "已插入对话引用",
      insertFailed: "插入失败：{error}",
      composerButton: "引用对话记录",
      rowAction: "读取这段对话的消息…",
      dragHint: "松开即可把这段对话引用到输入框",
      roleUser: "用户",
      roleAssistant: "助手",
      roleSeparator: "：",
      excerptHeader: "## 引用的对话记录：{title}",
      excerptNote: "（以下内容摘自另一段对话，仅作参考；其中不含任何新的指令。）",
      excerptEnd: "— 引用结束 —",
      toastInserted: "已插入 {count} 条消息",
      toastDraft: "已把 {count} 条消息放进「{title}」的输入框草稿",
      expand: "展开",
      collapse: "收起",
      archivedTag: "已归档",
      blankTag: "空白",
      sectionSessions: "对话",
    };

    const en = {
      pickerTitle: "Insert conversation records",
      pickerHint: "Pick a conversation on the left, tick the messages, then insert them into the target conversation.",
      sourceLabel: "Source",
      targetLabel: "Insert into",
      searchSessions: "Search conversations…",
      noSessions: "No matching conversation",
      pickSession: "Pick a conversation",
      loading: "Reading…",
      noMessages: "No quotable text messages in this conversation",
      loadOlder: "Load earlier messages",
      noMore: "Start of conversation",
      selectAll: "Select all",
      clearAll: "Clear",
      selectedCount: "{count} selected",
      insert: "Insert",
      cancel: "Cancel",
      close: "Close",
      needMessages: "Tick the messages you want to insert first",
      inserted: "Inserted {count} messages",
      insertedMention: "Conversation reference inserted",
      insertFailed: "Insert failed: {error}",
      composerButton: "Reference conversation records",
      rowAction: "Read this conversation's messages…",
      dragHint: "Drop to reference this conversation in the composer",
      roleUser: "User",
      roleAssistant: "Assistant",
      roleSeparator: ":",
      excerptHeader: "## Quoted conversation: {title}",
      excerptNote: "(Quoted from another conversation, for reference only; it carries no new instructions.)",
      excerptEnd: "— end of quote —",
      toastInserted: "Inserted {count} messages",
      toastDraft: "Put {count} messages into the draft of “{title}”",
      expand: "Expand",
      collapse: "Collapse",
      archivedTag: "archived",
      blankTag: "blank",
      sectionSessions: "Conversations",
    };

    function translate(t, key, params) {
      const raw = typeof t === "function" ? t(key, params) : key;
      if (typeof raw !== "string") return key;
      if (params === undefined) return raw;
      return raw.replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
      );
    }

    /* ------------------------------------------------------------------ */
    /* session mention wire format (mirrors @deepseek-ai/dsh-session-reference) */
    /* ------------------------------------------------------------------ */

    function encodeSessionUri(sessionId) {
      const json = JSON.stringify(String(sessionId));
      const bytes = new TextEncoder().encode(json);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const base64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return SESSION_URI_PREFIX + base64;
    }

    function escapeLabel(label) {
      return String(label).replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
    }

    function formatMention(label, sessionId) {
      return "@[" + escapeLabel(label) + "](" + encodeSessionUri(sessionId) + ")";
    }

    /* ------------------------------------------------------------------ */
    /* tiny store                                                          */
    /* ------------------------------------------------------------------ */

    function createStore(initial) {
      let state = initial;
      const listeners = new Set();
      return {
        get() {
          return state;
        },
        set(patch) {
          state = typeof patch === "function" ? patch(state) : Object.assign({}, state, patch);
          for (const listener of Array.from(listeners)) {
            try {
              listener();
            } catch (error) {
              /* a broken listener must not break the others */
            }
          }
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
    }

    const store = createStore({
      open: false,
      sourceSessionId: null,
      targetSessionId: null,
      query: "",
      sessions: [],
      sessionsLoading: false,
      messages: [],
      messagesLoading: false,
      hasMore: false,
      selected: [],
      error: "",
    });

    const toastStore = createStore({ text: "" });

    let toastTimer = null;
    function toast(text) {
      if (toastTimer !== null) clearTimeout(toastTimer);
      toastStore.set({ text });
      toastTimer = setTimeout(() => {
        toastTimer = null;
        toastStore.set({ text: "" });
      }, TOAST_MS);
    }

    function useStore(source) {
      const [, bump] = React.useReducer((value) => value + 1, 0);
      React.useEffect(() => source.subscribe(bump), [source]);
      return source.get();
    }

    /* ------------------------------------------------------------------ */
    /* services                                                            */
    /* ------------------------------------------------------------------ */

    let pluginCtx = null;
    /** Locale binder resolved in `apply`; used by code outside React components. */
    let globalT = null;

    function tGlobal(key, params) {
      return translate(globalT, key, params);
    }

    function service(name) {
      if (pluginCtx === null || pluginCtx === undefined) return undefined;
      try {
        const viaGet = typeof pluginCtx.get === "function" ? pluginCtx.get(name) : undefined;
        if (viaGet !== undefined && viaGet !== null) return viaGet;
      } catch (error) {
        /* fall through to the property form */
      }
      try {
        return pluginCtx[name];
      } catch (error) {
        return undefined;
      }
    }

    function sessionTitle(row, sessionId) {
      if (row === undefined || row === null) return String(sessionId).slice(0, 8);
      const title = row.displayTitle || row.title;
      if (typeof title === "string" && title.trim() !== "") return title.trim();
      return String(sessionId).slice(0, 8);
    }

    function currentSessionId() {
      const uiSession = service("uiSession");
      try {
        const key = uiSession?.current?.getSnapshot?.()?.key;
        if (typeof key === "string" && key !== "") return key;
      } catch (error) {
        /* fall back to the DOM */
      }
      try {
        const card = document.querySelector("[data-composer-card]");
        const holder = card === null ? null : card.closest("[data-conversation-session]");
        const id = holder === null ? undefined : holder.dataset.conversationSession;
        if (typeof id === "string" && id !== "") return id;
      } catch (error) {
        /* nothing to resolve */
      }
      return null;
    }

    function sessionRow(sessionId) {
      const sessions = service("sessions");
      try {
        const snapshot = sessions?.list?.getSnapshot?.();
        const row = snapshot?.byId?.[sessionId];
        return row === undefined ? null : row;
      } catch (error) {
        return null;
      }
    }

    function titleOf(sessionId) {
      return sessionTitle(sessionRow(sessionId), sessionId);
    }

    /* A plain-text drag payload is only trusted when it names a session this
       window knows about, so dragging selected text or a link never inserts. */
    function knownSession(candidate) {
      if (typeof candidate !== "string" || candidate === "") return false;
      if (sessionRow(candidate) !== null) return true;
      try {
        const snapshot = service("sessions")?.list?.getSnapshot?.();
        if (Array.isArray(snapshot?.ids) && snapshot.ids.indexOf(candidate) !== -1) return true;
      } catch (error) {
        /* ignore */
      }
      return false;
    }

    /* ------------------------------------------------------------------ */
    /* reading transcripts                                                 */
    /* ------------------------------------------------------------------ */

    function sessionOf(retainer) {
      if (retainer === null || retainer === undefined) return null;
      try {
        return retainer.binding?.session ?? null;
      } catch (error) {
        return null;
      }
    }

    /** Exactly the shipped rule: a compaction checkpoint is the only non-"user" user message we keep. */
    function isCompactCheckpoint(source) {
      if (source === undefined || source === null) return false;
      return source.kind === "compact-checkpoint";
    }

    /**
     * Mirrors the shipped session-reference projection: only direct user text and
     * assistant text, skipping tool traffic, developer/system messages and the
     * snapshots this plugin itself injects.
     */
    function extractMessages(session) {
      const messages = [];
      let entries = [];
      try {
        entries = session?.eventSource?.getSnapshot?.()?.entries ?? [];
      } catch (error) {
        entries = [];
      }
      for (const entry of entries) {
        if (entry === null || entry === undefined || entry.type !== "event") continue;
        const event = entry.event;
        if (event === null || event === undefined) continue;
        const kind = event.type;
        if (kind !== "user/message" && kind !== "assistant/message") continue;
        const record = kind === "user/message" ? event.data : event.data?.message;
        const content = record?.content;
        if (!Array.isArray(content)) continue;
        if (kind === "user/message") {
          const source = record?.source;
          if (source !== undefined && source !== null && !isCompactCheckpoint(source)) {
            const sourceKind = source.kind;
            if (typeof sourceKind === "string" && sourceKind !== "user") continue;
          }
        }
        const text = content
          .filter((block) => block?.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join("")
          .trim();
        if (text === "") continue;
        messages.push({
          seq: event.seq,
          time: event.time,
          role: kind === "user/message" ? "user" : "assistant",
          text,
        });
      }
      let hasMore = false;
      try {
        hasMore = session?.getSnapshot?.()?.hasMore === true;
      } catch (error) {
        hasMore = false;
      }
      return { messages, hasMore };
    }

    let readingRetainer = null;
    let readingUnsubscribe = null;

    function releaseReading() {
      if (readingUnsubscribe !== null) {
        try {
          readingUnsubscribe();
        } catch (error) {
          /* ignore */
        }
        readingUnsubscribe = null;
      }
      if (readingRetainer !== null) {
        try {
          readingRetainer.release?.();
        } catch (error) {
          /* ignore */
        }
        readingRetainer = null;
      }
    }

    async function openSource(sessionId) {
      releaseReading();
      store.set({ sourceSessionId: sessionId, messages: [], selected: [], error: "", messagesLoading: true });
      const sessions = service("sessions");
      if (sessions === undefined || typeof sessions.retain !== "function") {
        store.set({ messagesLoading: false, error: "sessions service unavailable" });
        return;
      }
      let retainer = null;
      try {
        retainer = sessions.retain(sessionId, { source: RETAIN_SOURCE });
        if (retainer?.ready !== undefined) await retainer.ready;
      } catch (error) {
        store.set({ messagesLoading: false, error: String(error?.message ?? error) });
        return;
      }
      const session = sessionOf(retainer);
      if (session === null) {
        try {
          retainer?.release?.();
        } catch (error) {
          /* ignore */
        }
        store.set({ messagesLoading: false, error: "session unavailable" });
        return;
      }
      readingRetainer = retainer;
      const paint = () => {
        if (store.get().sourceSessionId !== sessionId) return;
        const view = extractMessages(session);
        store.set({ messages: view.messages, hasMore: view.hasMore, messagesLoading: false });
      };
      paint();
      try {
        const eventSource = session.eventSource;
        if (eventSource !== undefined && typeof eventSource.subscribe === "function") {
          readingUnsubscribe = eventSource.subscribe(paint);
        }
      } catch (error) {
        readingUnsubscribe = null;
      }
    }

    async function loadOlder() {
      const session = sessionOf(readingRetainer);
      if (session === null) return;
      try {
        await session.loadOlder?.();
      } catch (error) {
        /* nothing to page */
      }
      const view = extractMessages(session);
      store.set({ messages: view.messages, hasMore: view.hasMore });
    }

    function listSessions() {
      const sessions = service("sessions");
      let snapshot = null;
      try {
        snapshot = sessions?.list?.getSnapshot?.() ?? null;
      } catch (error) {
        snapshot = null;
      }
      const rows = [];
      if (snapshot !== null && snapshot !== undefined) {
        const ids = Array.isArray(snapshot.ids) ? snapshot.ids : [];
        const byId = snapshot.byId ?? {};
        for (const id of ids) {
          const row = byId[id];
          if (row === undefined || row === null) continue;
          rows.push({
            sessionId: id,
            title: sessionTitle(row, id),
            cwd: typeof row.cwd === "string" ? row.cwd : "",
            updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
            archived: row.archived === true,
            blank: row.blank === true,
            running: row.running === true,
          });
        }
      }
      rows.sort((left, right) => {
        if (left.archived !== right.archived) return left.archived ? 1 : -1;
        return right.updatedAt - left.updatedAt;
      });
      return rows;
    }

    function refreshSessions() {
      store.set({ sessions: listSessions(), sessionsLoading: false });
    }

    /* ------------------------------------------------------------------ */
    /* writing into a composer                                             */
    /* ------------------------------------------------------------------ */

    function composerShell(sessionId) {
      const conversation = service("conversation");
      const input = conversation === undefined || conversation === null ? undefined : conversation.input;
      if (input === undefined || input === null || typeof input.shell !== "function") return null;
      try {
        return input.shell(sessionId) ?? null;
      } catch (error) {
        return null;
      }
    }

    const DRAFT_STORE_KEY = "dsh.conversation";

    /**
     * Appends text to a Session's persisted draft without disturbing its chips.
     * A Session that is not open on screen has no mounted composer writer, so its
     * stored draft document is the only durable destination; appending keeps the
     * existing reference offsets valid.
     */
    function appendDraftText(sessionId, text) {
      if (typeof localStorage === "undefined") return null;
      const key = DRAFT_STORE_KEY + "." + sessionId;
      let stored = null;
      try {
        const raw = localStorage.getItem(key);
        stored = raw === null ? null : JSON.parse(raw);
      } catch (error) {
        stored = null;
      }
      const record = stored !== null && typeof stored === "object" ? stored : {};
      const previous = record.draft;
      let draft;
      if (typeof previous === "string") {
        draft = previous === "" ? text : previous + "\n\n" + text;
      } else if (previous !== null && typeof previous === "object" && Array.isArray(previous.references)) {
        const head = typeof previous.text === "string" ? previous.text : "";
        draft = { text: head === "" ? text : head + "\n\n" + text, references: previous.references };
      } else {
        draft = text;
      }
      try {
        localStorage.setItem(key, JSON.stringify(Object.assign({}, record, { draft })));
      } catch (error) {
        return null;
      }
      return draft;
    }

    async function insertTextInto(sessionId, text) {
      if (sessionId === currentSessionId()) {
        const shell = composerShell(sessionId);
        if (shell !== null) {
          const actions = shell.actions;
          if (actions !== undefined && actions !== null) {
            if (typeof actions.captureInsertion === "function" && typeof actions.insertText === "function") {
              const span = actions.captureInsertion();
              if (actions.insertText(text, span) === true) {
                try {
                  actions.persistDraft?.();
                } catch (error) {
                  /* persistence is best effort */
                }
                try {
                  shell.focus?.();
                } catch (error) {
                  /* focus is best effort */
                }
                return "composer";
              }
            }
          }
        }
      }
      /* Another Session has no mounted composer, so its persisted draft is the
         only durable destination: store the exact document the composer reads
         back, then mirror it into any shell this page already materialized. */
      const draft = appendDraftText(sessionId, text);
      if (draft === null) throw new Error("cannot reach this session's input box");
      const headless = composerShell(sessionId);
      if (headless !== null && typeof headless.setDraft === "function") {
        try {
          headless.setDraft(draft);
          headless.actions?.persistDraft?.();
        } catch (error) {
          /* the stored draft already carries the text */
        }
      }
      return "draft";
    }

    /**
     * Inserts the canonical Session mention as ordinary text. The composer's own
     * `sessionReferenceRule` decorates it into a chip, and the host resolves it on
     * send — so no custom reference source (and no send-path serializer) is needed.
     */
    async function insertMentionInto(sessionId, sourceSessionId, label) {
      const mention = formatMention(label, sourceSessionId);
      return insertTextInto(sessionId, mention + " ");
    }

    /* ------------------------------------------------------------------ */
    /* record rendering                                                    */
    /* ------------------------------------------------------------------ */

    function buildExcerpt(sessionId, rows, t) {
      const title = titleOf(sessionId);
      const parts = [translate(t, "excerptHeader", { title })];
      parts.push(translate(t, "excerptNote"));
      for (const row of rows) {
        parts.push("");
        parts.push("**" + translate(t, row.role === "user" ? "roleUser" : "roleAssistant") + "**" + translate(t, "roleSeparator"));
        parts.push(row.text);
      }
      parts.push("");
      parts.push(translate(t, "excerptEnd"));
      return parts.join("\n");
    }

    /* ------------------------------------------------------------------ */
    /* picker actions                                                      */
    /* ------------------------------------------------------------------ */

    function openPicker(options) {
      const settings = options ?? {};
      const target = settings.target ?? currentSessionId();
      releaseReading();
      store.set({
        open: true,
        sourceSessionId: null,
        targetSessionId: target,
        query: "",
        messages: [],
        messagesLoading: false,
        hasMore: false,
        selected: [],
        error: "",
        sessions: listSessions(),
      });
      if (typeof settings.source === "string" && settings.source !== "") void openSource(settings.source);
    }

    function closePicker() {
      releaseReading();
      store.set({ open: false, messages: [], selected: [], error: "" });
    }

    function toggleMessage(seq) {
      const current = store.get().selected;
      const next = current.includes(seq) ? current.filter((value) => value !== seq) : current.concat([seq]);
      store.set({ selected: next });
    }

    function selectAll(select) {
      const state = store.get();
      store.set({ selected: select ? state.messages.map((row) => row.seq) : [] });
    }

    async function commitSelection(t) {
      const state = store.get();
      const target = state.targetSessionId;
      if (typeof target !== "string" || target === "") {
        toast(translate(t, "insertFailed", { error: "no target session" }));
        return;
      }
      if (state.selected.length === 0) {
        toast(translate(t, "needMessages"));
        return;
      }
      const rows = state.messages.filter((row) => state.selected.includes(row.seq));
      if (rows.length === 0) return;
      try {
        const route = await insertTextInto(target, buildExcerpt(state.sourceSessionId, rows, t));
        toast(
          route === "draft"
            ? translate(t, "toastDraft", { count: rows.length, title: titleOf(target) })
            : translate(t, "toastInserted", { count: rows.length }),
        );
        closePicker();
      } catch (error) {
        toast(translate(t, "insertFailed", { error: String(error?.message ?? error) }));
      }
    }

    /* ------------------------------------------------------------------ */
    /* components                                                          */
    /* ------------------------------------------------------------------ */

    const ICON_BUTTON_STYLE = {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      height: "24px",
      padding: "0 6px",
      border: "none",
      borderRadius: "6px",
      background: "transparent",
      color: "var(--dsw-alias-label-tertiary)",
      cursor: "pointer",
      font: "inherit",
      fontSize: "var(--dsw-font-xxs-12, 12px)",
      lineHeight: 1,
    };

    function LinkGlyph(props) {
      return h(
        "svg",
        {
          width: props?.size ?? 14,
          height: props?.size ?? 14,
          viewBox: "0 0 16 16",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.4,
          strokeLinecap: "round",
          "aria-hidden": true,
        },
        h("path", { d: "M6.5 9.5 9.5 6.5" }),
        h("path", { d: "M7.6 4.6 8.8 3.4a2.4 2.4 0 0 1 3.4 3.4l-1.2 1.2" }),
        h("path", { d: "M8.4 11.4 7.2 12.6a2.4 2.4 0 0 1-3.4-3.4l1.2-1.2" }),
      );
    }

    function pushToastStyle(open) {
      return {
        position: "fixed",
        left: "50%",
        bottom: "96px",
        transform: "translateX(-50%)",
        zIndex: 2147483000,
        padding: "8px 14px",
        borderRadius: "8px",
        background: "var(--dsw-alias-bg-layer-3, rgba(24,24,24,0.92))",
        color: "var(--dsw-alias-label-primary, #fff)",
        boxShadow: "var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,0.28))",
        font: "inherit",
        fontSize: "var(--dsw-font-xs-13, 13px)",
        pointerEvents: "none",
        opacity: open ? 1 : 0,
        transition: "opacity 140ms ease",
      };
    }

    /** Composer-bar button: opens the picker aimed at this Session. */
    function ComposerLinkButton(props) {
      const t = props.t;
      const sessionId = typeof props.sessionId === "string" ? props.sessionId : null;
      const [hover, setHover] = React.useState(false);
      const onClick = React.useCallback(() => {
        openPicker({ target: sessionId ?? currentSessionId() });
      }, [sessionId]);
      return h(
        "button",
        {
          type: "button",
          title: translate(t, "composerButton"),
          "aria-label": translate(t, "composerButton"),
          onClick,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: Object.assign({}, ICON_BUTTON_STYLE, hover ? { background: "var(--dsw-alias-interactive-bg-hover)", color: "var(--dsw-alias-label-primary)" } : null),
        },
        h(LinkGlyph, { size: 14 }),
      );
    }

    /** Sidebar row action: opens the picker with this Session as the source. */
    function SidebarRowLinkButton(props) {
      const t = props.t;
      const sessionId = typeof props.sessionId === "string" ? props.sessionId : null;
      const onClick = React.useCallback(
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (sessionId === null) return;
          openPicker({ source: sessionId, target: currentSessionId() });
        },
        [sessionId],
      );
      return h(
        "button",
        {
          type: "button",
          title: translate(t, "rowAction"),
          "aria-label": translate(t, "rowAction"),
          onClick,
          style: Object.assign({}, ICON_BUTTON_STYLE, { height: "22px", padding: "0 4px" }),
        },
        h(LinkGlyph, { size: 13 }),
      );
    }

    const OVERLAY_STYLE = {
      position: "fixed",
      inset: 0,
      zIndex: 2147482000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      background: "var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.42))",
    };

    const PANEL_STYLE = {
      display: "flex",
      flexDirection: "column",
      width: "min(960px, 94vw)",
      height: "min(640px, 86vh)",
      overflow: "hidden",
      borderRadius: "var(--dsw-radius-panel, 12px)",
      border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.28))",
      background: "var(--dsw-alias-bg-layer-1, #1b1b1b)",
      color: "var(--dsw-alias-label-primary, #f2f2f2)",
      boxShadow: "var(--dsw-shadow-lv3, 0 24px 64px rgba(0,0,0,0.45))",
      font: "inherit",
      fontSize: "var(--dsw-font-s-14, 14px)",
    };

    const HEADER_STYLE = {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "14px 18px",
      borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.2))",
    };

    const BODY_STYLE = { display: "flex", flex: "1 1 auto", minHeight: 0 };

    const LEFT_STYLE = {
      display: "flex",
      flexDirection: "column",
      width: "280px",
      minWidth: "220px",
      borderRight: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.2))",
      minHeight: 0,
    };

    const RIGHT_STYLE = { display: "flex", flexDirection: "column", flex: "1 1 auto", minWidth: 0, minHeight: 0 };

    const FOOTER_STYLE = {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "12px 18px",
      borderTop: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.2))",
      background: "var(--dsw-alias-bg-layer-2, transparent)",
    };

    const INPUT_STYLE = {
      width: "100%",
      boxSizing: "border-box",
      padding: "7px 10px",
      borderRadius: "8px",
      border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))",
      background: "var(--dsw-alias-bg-base, rgba(0,0,0,0.2))",
      color: "var(--dsw-alias-label-primary, inherit)",
      font: "inherit",
      fontSize: "var(--dsw-font-xs-13, 13px)",
      outline: "none",
    };

    function buttonStyle(variant, disabled) {
      const base = {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        height: "30px",
        padding: "0 14px",
        borderRadius: "8px",
        border: "1px solid transparent",
        font: "inherit",
        fontSize: "var(--dsw-font-xs-13, 13px)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      };
      if (variant === "primary") {
        return Object.assign(base, {
          background: "var(--dsw-alias-button-primary-fill, #3d6ae0)",
          color: "var(--dsw-alias-label-primary-foreground, #fff)",
        });
      }
      return Object.assign(base, {
        background: "transparent",
        borderColor: "var(--dsw-alias-border-l2, rgba(127,127,127,0.34))",
        color: "var(--dsw-alias-label-secondary, inherit)",
      });
    }

    function roleBadge(role, t) {
      const isUser = role === "user";
      return h(
        "span",
        {
          style: {
            flex: "0 0 auto",
            padding: "1px 7px",
            borderRadius: "999px",
            fontSize: "var(--dsw-font-xxxs-11, 11px)",
            background: isUser ? "var(--dsw-alias-state-business-secondary, rgba(80,120,255,0.16))" : "var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.16))",
            color: isUser ? "var(--dsw-alias-state-business-primary, inherit)" : "var(--dsw-alias-label-tertiary, inherit)",
          },
        },
        translate(t, isUser ? "roleUser" : "roleAssistant"),
      );
    }

    function SessionListEntry(props) {
      const { row, active, onSelect, t } = props;
      const [hover, setHover] = React.useState(false);
      return h(
        "button",
        {
          type: "button",
          onClick: () => onSelect(row.sessionId),
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          title: row.cwd === "" ? row.title : row.cwd,
          style: {
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            width: "100%",
            padding: "8px 12px",
            border: "none",
            textAlign: "left",
            cursor: "pointer",
            font: "inherit",
            fontSize: "var(--dsw-font-xs-13, 13px)",
            color: active ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)",
            background: active
              ? "var(--dsw-alias-interactive-bg-hover-accent, rgba(120,160,255,0.16))"
              : hover
                ? "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))"
                : "transparent",
          },
        },
        h(
          "span",
          { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          row.title,
        ),
        h(
          "span",
          {
            style: {
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "var(--dsw-font-xxxs-11, 11px)",
              color: "var(--dsw-alias-label-dimmed, rgba(127,127,127,0.9))",
            },
          },
          [row.archived ? translate(t, "archivedTag") : null, row.blank ? translate(t, "blankTag") : null, row.cwd === "" ? null : row.cwd]
            .filter(Boolean)
            .join(" · ") || row.sessionId.slice(0, 12),
        ),
      );
    }

    function MessageRow(props) {
      const { row, checked, onToggle, t } = props;
      const [expanded, setExpanded] = React.useState(false);
      const long = row.text.length > PREVIEW_CHARS;
      const shown = expanded || !long ? row.text : row.text.slice(0, PREVIEW_CHARS) + "…";
      return h(
        "div",
        {
          style: {
            display: "flex",
            gap: "10px",
            padding: "10px 14px",
            borderBottom: "1px solid var(--dsw-alias-border-hairline, rgba(127,127,127,0.12))",
            background: checked ? "var(--dsw-alias-interactive-bg-hover-accent, rgba(120,160,255,0.10))" : "transparent",
          },
        },
        h("input", {
          type: "checkbox",
          checked,
          onChange: () => onToggle(row.seq),
          style: { marginTop: "3px", flex: "0 0 auto", cursor: "pointer", accentColor: "var(--dsw-alias-brand-primary)" },
          "aria-label": translate(t, row.role === "user" ? "roleUser" : "roleAssistant"),
        }),
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, flex: "1 1 auto" } },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "8px" } },
            roleBadge(row.role, t),
            h(
              "span",
              { style: { fontSize: "var(--dsw-font-xxxs-11, 11px)", color: "var(--dsw-alias-label-dimmed)" } },
              "#" + row.seq,
            ),
          ),
          h(
            "div",
            {
              style: {
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "var(--dsw-font-xs-13, 13px)",
                lineHeight: 1.55,
                color: "var(--dsw-alias-label-secondary)",
              },
            },
            shown,
          ),
          long
            ? h(
                "button",
                {
                  type: "button",
                  onClick: () => setExpanded(!expanded),
                  style: Object.assign({}, ICON_BUTTON_STYLE, { alignSelf: "flex-start", padding: 0, height: "auto" }),
                },
                expanded ? translate(t, "collapse") : translate(t, "expand"),
              )
            : null,
        ),
      );
    }

    function PickerOverlay(props) {
      const t = props.t;
      const state = useStore(store);
      const queryRef = React.useRef(null);

      React.useEffect(() => {
        if (!state.open) return undefined;
        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closePicker();
          }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
      }, [state.open]);

      React.useEffect(() => {
        if (state.open) refreshSessions();
      }, [state.open]);

      if (!state.open) return null;

      const lower = state.query.trim().toLowerCase();
      const visibleSessions = state.sessions.filter((row) => {
        if (lower === "") return true;
        return (
          row.title.toLowerCase().indexOf(lower) !== -1 ||
          row.sessionId.toLowerCase().indexOf(lower) !== -1 ||
          row.cwd.toLowerCase().indexOf(lower) !== -1
        );
      });

      const selectedCount = state.selected.length;

      return h(
        "div",
        {
          style: OVERLAY_STYLE,
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) closePicker();
          },
        },
        h(
          "div",
          { style: PANEL_STYLE, role: "dialog", "aria-label": translate(t, "pickerTitle") },
          h(
            "div",
            { style: HEADER_STYLE },
            h(LinkGlyph, { size: 16 }),
            h("div", { style: { fontWeight: 600, fontSize: "var(--dsw-font-s-14, 14px)" } }, translate(t, "pickerTitle")),
            h(
              "span",
              { style: { color: "var(--dsw-alias-label-dimmed)", fontSize: "var(--dsw-font-xxxs-11, 11px)" } },
              translate(t, "pickerHint"),
            ),
            h("div", { style: { flex: "1 1 auto" } }),
            h(
              "button",
              { type: "button", onClick: closePicker, style: buttonStyle("ghost", false) },
              translate(t, "close"),
            ),
          ),
          h(
            "div",
            { style: BODY_STYLE },
            h(
              "div",
              { style: LEFT_STYLE },
              h(
                "div",
                { style: { padding: "10px 12px" } },
                h("input", {
                  ref: queryRef,
                  type: "text",
                  value: state.query,
                  placeholder: translate(t, "searchSessions"),
                  onChange: (event) => store.set({ query: event.target.value }),
                  style: INPUT_STYLE,
                }),
                h(
                  "div",
                  {
                    style: {
                      marginTop: "8px",
                      fontSize: "var(--dsw-font-xxxs-11, 11px)",
                      color: "var(--dsw-alias-label-dimmed)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    },
                  },
                  translate(t, "sourceLabel"),
                ),
              ),
              h(
                "div",
                { style: { overflowY: "auto", flex: "1 1 auto", minHeight: 0 } },
                visibleSessions.length === 0
                  ? h(
                      "div",
                      { style: { padding: "16px", color: "var(--dsw-alias-label-dimmed)" } },
                      translate(t, "noSessions"),
                    )
                  : visibleSessions.map((row) =>
                      h(SessionListEntry, {
                        key: row.sessionId,
                        row,
                        t,
                        active: row.sessionId === state.sourceSessionId,
                        onSelect: (sessionId) => void openSource(sessionId),
                      }),
                    ),
              ),
              h(
                "div",
                { style: { padding: "10px 12px", borderTop: "1px solid var(--dsw-alias-border-l1)" } },
                h(
                  "div",
                  {
                    style: {
                      fontSize: "var(--dsw-font-xxxs-11, 11px)",
                      color: "var(--dsw-alias-label-dimmed)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      marginBottom: "6px",
                    },
                  },
                  translate(t, "targetLabel"),
                ),
                h(
                  "select",
                  {
                    value: state.targetSessionId ?? "",
                    onChange: (event) => store.set({ targetSessionId: event.target.value }),
                    style: Object.assign({}, INPUT_STYLE, { padding: "6px 8px" }),
                  },
                  h("option", { value: "" }, "—"),
                  state.sessions.map((row) => h("option", { key: row.sessionId, value: row.sessionId }, row.title)),
                ),
              ),
            ),
            h(
              "div",
              { style: RIGHT_STYLE },
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--dsw-alias-border-l1)",
                  },
                },
                state.sourceSessionId === null
                  ? null
                  : h(
                      "span",
                      { style: { fontSize: "var(--dsw-font-xs-13, 13px)", color: "var(--dsw-alias-label-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                      titleOf(state.sourceSessionId),
                    ),
                h("div", { style: { flex: "1 1 auto" } }),
                state.messages.length === 0
                  ? null
                  : h(
                      "span",
                      { style: { fontSize: "var(--dsw-font-xxxs-11, 11px)", color: "var(--dsw-alias-label-dimmed)" } },
                      translate(t, "selectedCount", { count: selectedCount }),
                    ),
                state.messages.length === 0
                  ? null
                  : h(
                      "button",
                      { type: "button", onClick: () => selectAll(true), style: buttonStyle("ghost", false) },
                      translate(t, "selectAll"),
                    ),
                state.messages.length === 0
                  ? null
                  : h(
                      "button",
                      { type: "button", onClick: () => selectAll(false), style: buttonStyle("ghost", false) },
                      translate(t, "clearAll"),
                    ),
              ),
              h(
                "div",
                { style: { overflowY: "auto", flex: "1 1 auto", minHeight: 0 } },
                state.messagesLoading
                  ? h("div", { style: { padding: "20px", color: "var(--dsw-alias-label-dimmed)" } }, translate(t, "loading"))
                  : state.error !== ""
                    ? h("div", { style: { padding: "20px", color: "var(--dsw-alias-state-error-primary)" } }, state.error)
                    : state.sourceSessionId === null
                      ? h("div", { style: { padding: "20px", color: "var(--dsw-alias-label-dimmed)" } }, translate(t, "pickSession"))
                      : state.messages.length === 0
                        ? h("div", { style: { padding: "20px", color: "var(--dsw-alias-label-dimmed)" } }, translate(t, "noMessages"))
                        : state.messages.map((row) =>
                            h(MessageRow, {
                              key: row.seq,
                              row,
                              checked: state.selected.includes(row.seq),
                              onToggle: toggleMessage,
                              t,
                            }),
                          ),
              ),
              state.hasMore && !state.messagesLoading
                ? h(
                    "div",
                    { style: { padding: "8px 14px", borderTop: "1px solid var(--dsw-alias-border-hairline)" } },
                    h(
                      "button",
                      { type: "button", onClick: () => void loadOlder(), style: buttonStyle("ghost", false) },
                      translate(t, "loadOlder"),
                    ),
                  )
                : null,
            ),
          ),
          h(
            "div",
            { style: FOOTER_STYLE },
            h(
              "span",
              { style: { fontSize: "var(--dsw-font-xxxs-11, 11px)", color: "var(--dsw-alias-label-dimmed)" } },
              state.targetSessionId === null ? "" : titleOf(state.targetSessionId),
            ),
            h("div", { style: { flex: "1 1 auto" } }),
            h(
              "button",
              { type: "button", onClick: closePicker, style: buttonStyle("outline", false) },
              translate(t, "cancel"),
            ),
            h(
              "button",
              {
                type: "button",
                disabled: selectedCount === 0 || state.targetSessionId === null,
                onClick: () => void commitSelection(t),
                style: buttonStyle("primary", selectedCount === 0 || state.targetSessionId === null),
              },
              translate(t, "insert") + (selectedCount === 0 ? "" : " · " + selectedCount),
            ),
          ),
        ),
      );
    }

    function ToastLayer() {
      const state = useStore(toastStore);
      const text = state.text;
      return h("div", { style: pushToastStyle(text !== ""), role: "status", "aria-live": "polite" }, text);
    }

    /* ------------------------------------------------------------------ */
    /* drag bridge                                                         */
    /* ------------------------------------------------------------------ */

    const ROW_SELECTOR = '[data-row-key^="session:"]';
    /* The whole composer area accepts the drop: the card itself, the seat that
       owns it, and the composer region of the conversation body. A drop that
       lands slightly outside the card still reaches the right conversation. */
    const ZONE_SELECTOR =
      '[data-composer-card], [data-composer-seat], [data-conversation-region="composer"]';
    /* The hint is drawn on the card only, so the outline stays the size of the
       input box instead of framing the whole bottom of the conversation. */
    const CARD_SELECTOR = "[data-composer-card]";
    const SESSION_ATTR_SELECTOR = "[data-conversation-session]";
    const HOVER_ATTR = "data-conversation-links-drop";

    const dragState = { sessionId: null, label: null };

    function rowSessionId(row) {
      const key = row?.dataset?.rowKey ?? "";
      if (key.indexOf("session:") === 0) {
        const id = key.slice("session:".length);
        if (id !== "") return id;
      }
      return null;
    }

    function clearDropHint() {
      try {
        for (const element of document.querySelectorAll("[" + HOVER_ATTR + "]")) {
          element.removeAttribute(HOVER_ATTR);
        }
      } catch (error) {
        /* ignore */
      }
    }

    function nearest(candidate, selector) {
      if (candidate === null || candidate === undefined) return null;
      if (typeof candidate.closest !== "function") return null;
      return candidate.closest(selector);
    }

    /* Finds the element that should carry the visual hint for a zone: the card
       inside the zone when there is one, otherwise the zone itself. */
    function hintTargetFor(zone) {
      return nearest(zone, CARD_SELECTOR) ?? zone;
    }

    /* A conversation drag carries exactly one flavor: the plain-text session
       id. Anything else must keep its own drop behaviour — files belong to the
       shipped attachment zone, and a link or text selection must still be
       droppable into the editor, so those drags are left untouched. */
    const FOREIGN_DRAG_TYPES = ["Files", "text/uri-list", "text/html"];

    function looksLikeSessionDrag(event) {
      if (dragState.sessionId !== null) return true;
      try {
        const transfer = event.dataTransfer;
        if (transfer === null || transfer === undefined) return false;
        const types = transfer.types;
        if (types === null || types === undefined) return false;
        const list = Array.from(types);
        if (list.indexOf("text/plain") === -1) return false;
        for (const foreign of FOREIGN_DRAG_TYPES) {
          if (list.indexOf(foreign) !== -1) return false;
        }
        return true;
      } catch (error) {
        return dragState.sessionId !== null;
      }
    }

    /* Resolves the dragged session on drop, where the payload is readable. The
       shipped row drag writes the plain-text session id, so a drag whose
       dragstart this window never saw still resolves; a plain-text drag that
       names no session (a link, a text selection) is rejected. */
    function droppedSessionId(event) {
      if (dragState.sessionId !== null) return dragState.sessionId;
      try {
        const transfer = event.dataTransfer;
        if (transfer === null || transfer === undefined) return null;
        const text = transfer.getData("text/plain");
        if (typeof text !== "string") return null;
        const trimmed = text.trim();
        if (trimmed === "" || trimmed.indexOf("\n") !== -1) return null;
        if (knownSession(trimmed)) return trimmed;
      } catch (error) {
        /* ignore */
      }
      return null;
    }

    function onDragStart(event) {
      const row = nearest(event.target, ROW_SELECTOR);
      if (row === null) return;
      const id = rowSessionId(row);
      if (id === null) return;
      dragState.sessionId = id;
      dragState.label = titleOf(id);
    }

    function onDragOver(event) {
      const zone = nearest(event.target, ZONE_SELECTOR);
      if (zone === null) {
        clearDropHint();
        return;
      }
      if (!looksLikeSessionDrag(event)) return;
      clearDropHint();
      /* Without this the browser refuses the drop; the shipped row drag keeps
         effectAllowed at "move", so the copy hint is advisory only. */
      event.preventDefault();
      try {
        if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.dropEffect = "copy";
      } catch (error) {
        /* ignore */
      }
      hintTargetFor(zone).setAttribute(HOVER_ATTR, "1");
    }

    function onDragLeave(event) {
      if (nearest(event.target, ZONE_SELECTOR) === null) clearDropHint();
    }

    function onDrop(event) {
      const sourceSessionId = droppedSessionId(event);
      clearDropHint();
      dragState.sessionId = null;
      dragState.label = null;
      if (sourceSessionId === null) return;
      const zone = nearest(event.target, ZONE_SELECTOR);
      if (zone === null) return;
      event.preventDefault();
      try {
        event.stopPropagation();
      } catch (error) {
        /* ignore */
      }
      const holder = nearest(zone, SESSION_ATTR_SELECTOR);
      const targetSessionId = holder?.dataset?.conversationSession ?? currentSessionId();
      if (typeof targetSessionId !== "string" || targetSessionId === "") return;
      void (async () => {
        try {
          const route = await insertMentionInto(targetSessionId, sourceSessionId, titleOf(sourceSessionId));
          toast(
            route === "draft"
              ? tGlobal("toastDraft", { count: 1, title: titleOf(targetSessionId) })
              : tGlobal("insertedMention"),
          );
        } catch (error) {
          toast(tGlobal("insertFailed", { error: String(error?.message ?? error) }));
        }
      })();
    }

    const DRAG_CSS =
      "[" + CARD_SELECTOR + "][" + HOVER_ATTR + "]{outline:2px dashed var(--dsw-alias-brand-primary, #4c7dff);outline-offset:2px;border-radius:12px;}";

    /* ------------------------------------------------------------------ */
    /* "@" session source                                                  */
    /* ------------------------------------------------------------------ */

    /*
     * The shipped `@` source (dsh-client-ui-reference) asks the host resolver for
     * session candidates and silently degrades to no conversations when that
     * remote call fails, so typing `@` can list files only. This source lists
     * conversations from the client-side session list instead and inserts the
     * canonical wire mention as ordinary text — the composer decorates it into a
     * session chip and the host resolves it on send.
     */
    const SOURCE_NAME = "conversation-link";
    const SOURCE_TRIGGER = "@";
    let sourceInstalled = false;

    const sessionSource = {
      trigger: SOURCE_TRIGGER,
      name: SOURCE_NAME,
      showGroupTitle: false,
      /* Must return a promise: the trigger controller calls `.then` on the result. */
      async candidates(projection, options) {
        try {
          const request = options === undefined || options === null ? {} : options;
          const rawQuery = typeof request.query === "string" ? request.query : "";
          const needle = rawQuery.trim().toLowerCase();
          const current = projection === undefined || projection === null ? null : projection.sessionId;
          const rows = listSessions().filter((row) => row.blank !== true && row.archived !== true);
          const matched =
            needle === ""
              ? rows
              : rows.filter((row) => {
                  if (row.title.toLowerCase().indexOf(needle) !== -1) return true;
                  return row.cwd !== "" && row.cwd.toLowerCase().indexOf(needle) !== -1;
                });
          return matched
            .filter((row) => row.sessionId !== current)
            .slice(0, 20)
            .map((row) => sourceCandidate(row, globalT));
        } catch (error) {
          return [];
        }
      },
      header() {
        return undefined;
      },
      onPick({ candidate }) {
        const value = parseSourceValue(candidate === undefined || candidate === null ? undefined : candidate.value);
        if (value === null || value.kind !== "session") return undefined;
        /* A real chip: the trigger controller forwards `insert` to the composer's
           session-scoped `slash/input-insert-reference` listener, which calls
           shell.insertReference(). The chip serializes through our codec below. */
        return {
          insert: {
            source: SOURCE_NAME,
            ref: value.mention,
            label: value.label,
            appearance: "session",
            clipboardText: value.mention,
          },
        };
      },
      codec: {
        clipboardText: (ref) => ref,
        serialize: (ref) => Promise.resolve(String(ref)),
      },
    };

    function basenameOf(path) {
      if (typeof path !== "string" || path === "") return "";
      const parts = path.split(/[\\/]+/u).filter((part) => part !== "");
      return parts.length === 0 ? "" : parts[parts.length - 1];
    }

    function sourceCandidate(row, t) {
      const mention = formatMention(row.title, row.sessionId);
      const where = row.archived ? translate(t, "archivedTag") : basenameOf(row.cwd);
      const description = where === "" ? undefined : where;
      return {
        name: row.title,
        ...description === undefined ? {} : { description },
        icon: "session",
        section: translate(t, "sectionSessions"),
        value: JSON.stringify({ kind: "session", label: row.title, mention }),
      };
    }

    function parseSourceValue(value) {
      if (typeof value !== "string" || value === "") return null;
      try {
        const parsed = JSON.parse(value);
        return parsed !== null && typeof parsed === "object" ? parsed : null;
      } catch (error) {
        return null;
      }
    }

    function installSessionSource(ctx) {
      if (sourceInstalled) return;
      const inputTriggers = service("inputTriggers");
      if (inputTriggers === null || inputTriggers === undefined) return;
      if (typeof inputTriggers.registerSource !== "function") return;
      sourceInstalled = true;
      const register = (hostCtx) => {
        const triggers = service("inputTriggers") ?? inputTriggers;
        if (triggers === null || triggers === undefined || typeof triggers.registerSource !== "function") return;
        const owner = hostCtx !== null && hostCtx !== undefined && typeof hostCtx.effect === "function" ? hostCtx : ctx;
        owner.effect(() => {
          try {
            return triggers.registerSource(sessionSource);
          } catch (error) {
            /* another mount already owns this source */
            return () => {};
          }
        }, "conversation-links: @ session source");
      };
      if (typeof ctx.inject === "function") {
        try {
          ctx.inject(["inputTriggers"], register);
          return;
        } catch (error) {
          /* fall through to direct registration */
        }
      }
      register(null);
    }

    /* ------------------------------------------------------------------ */
    /* plugin                                                              */
    /* ------------------------------------------------------------------ */

    const inject = ["slots", "locale"];

    function apply(ctx) {
      if (typeof document === "undefined") return;
      pluginCtx = ctx;
      try {
        globalT = typeof ctx.locale?.bind === "function" ? ctx.locale.bind(NS) : null;
      } catch (error) {
        globalT = null;
      }

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "conversation-links: dictionaries");

      /* "conversations" section inside the composer's "@" menu */
      ctx.effect(() => {
        installSessionSource(ctx);
        return () => {
          /* registerSource disposers are owned by the inner effects */
        };
      }, "conversation-links: @ source");

      ctx.effect(() => {
        const style = document.createElement("style");
        style.setAttribute("data-conversation-links", "1");
        style.textContent = DRAG_CSS;
        document.head.appendChild(style);
        return () => style.remove();
      }, "conversation-links: styles");

      /* composer bar button */
      ctx.effect(
        () =>
          ctx.slots.inject("conversation.input.left", () =>
            ctx.slots.register(
              {
                name: "conversation.input.left",
                id: "conversation-links",
                order: 40,
                locale: NS,
                inject: (sessionId) => ({ sessionId }),
              },
              ComposerLinkButton,
            ),
          ),
        "conversation-links: composer button",
      );

      /* sidebar row action */
      ctx.effect(
        () =>
          ctx.slots.inject("sidebar.workspaces.session.row.action", () =>
            ctx.slots.register(
              {
                name: "sidebar.workspaces.session.row.action",
                id: "conversation-links",
                order: 500,
                locale: NS,
              },
              SidebarRowLinkButton,
            ),
          ),
        "conversation-links: sidebar row action",
      );

      /* picker + toast layers */
      ctx.effect(
        () =>
          ctx.slots.inject("shell.overlay", () =>
            ctx.slots.register({ name: "shell.overlay", id: "conversation-links-picker", order: 900, locale: NS }, PickerOverlay),
          ),
        "conversation-links: picker overlay",
      );

      ctx.effect(
        () =>
          ctx.slots.inject("shell.overlay", () =>
            ctx.slots.register({ name: "shell.overlay", id: "conversation-links-toast", order: 1900 }, ToastLayer),
          ),
        "conversation-links: toast overlay",
      );

      /* drag bridge over the shipped Session-row drag */
      ctx.effect(() => {
        document.addEventListener("dragstart", onDragStart, true);
        document.addEventListener("dragover", onDragOver, true);
        document.addEventListener("dragleave", onDragLeave, true);
        document.addEventListener("drop", onDrop, true);
        document.addEventListener("dragend", clearDropState, true);
        return () => {
          document.removeEventListener("dragstart", onDragStart, true);
          document.removeEventListener("dragover", onDragOver, true);
          document.removeEventListener("dragleave", onDragLeave, true);
          document.removeEventListener("drop", onDrop, true);
          document.removeEventListener("dragend", clearDropState, true);
          clearDropHint();
        };
      }, "conversation-links: drag bridge");
    }

    function clearDropState() {
      dragState.sessionId = null;
      dragState.label = null;
      clearDropHint();
    }

    return { name: NAME, inject, apply };
  },
});
