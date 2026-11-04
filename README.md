# dsh-conversation-links

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-conversation-links.svg)](https://www.npmjs.com/package/dsh-conversation-links)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.0--rc.2-4c7dff.svg)](https://github.com/deepseek-ai)
[![platform](https://img.shields.io/badge/platform-web-lightgrey.svg)](#)

**English** | [简体中文](./README.zh-CN.md)

Bring the record of one DSH conversation into another: mention it with `@`, drag it in from the sidebar, or open a conversation, tick a few of its messages and insert them somewhere else.


## Install

Either route works; reload the DSH page afterwards (`Ctrl+R` in the desktop app):

**From a GitHub Release** (no clone needed):

Download `dsh-conversation-links-<version>.tgz` from the [latest release](https://github.com/Penguin-SAMA/dsh-conversation-links/releases/latest),
extract it to get the `package/` directory, then:

```text
plugin_manager action=install_bundle target=<absolute path to the extracted package directory>
```

**From source**:

```bash
git clone https://github.com/Penguin-SAMA/dsh-conversation-links.git
```

```text
plugin_manager action=install_bundle target=<absolute path to the clone>
```

Uninstall: `plugin_manager action=set_bundle target=dsh-conversation-links enabled=false`.

> It is also published on npm (`npm i dsh-conversation-links`), but DSH's `install_bundle`
> takes an **absolute directory path**, so point it at `node_modules/dsh-conversation-links`
> when installing from npm. Everything else is the same.

## Usage

There are three ways to use it.

### 1. Mention another conversation with `@`

Type `@` in the composer: the candidate panel first lists "Files & folders", then a
"Conversations" group (the `@conversation-link` source this plugin registers). Picking a
conversation inserts a conversation chip into the composer; on send, the host attaches a
read-only snapshot of that conversation as a separate user message (`## Referenced sessions`).

> **Why this plugin registers its own `@` source:** the built-in DSH source
> (`@deepseek-ai/dsh-client-ui-reference`) asks the host remote
> `sessionReferenceResolver.candidates` for its conversation candidates, and handles failure
> as `result.ok ? result.value : []` — one remote error **silently degrades to an empty
> array**. File candidates still render, so `@` shows only "Files & folders" and no
> conversations at all (that is exactly what happened on this machine). This plugin's
> `@conversation-link` source reads the client-side session list (`sessions.list`) instead
> and does not depend on the host remote, so the group can no longer vanish silently.
>
> Both sources insert the same wire format, `@[title](dsh-session:<base64url>)`, so it is
> fully compatible with a hand-typed `@` and with DSH's own reference chips. Snapshot
> injection on send is still done by the built-in `@deepseek-ai/dsh-session-reference`;
> this plugin does not reimplement it.

Implementation notes (read before touching this code):

- `candidates(projection, { query, quoted, drilled, signal })` **must return a Promise / be
  declared `async`**: the trigger controller does `source.candidates(...).then(...)`, and a
  synchronous array throws — the whole group then disappears without a trace.
- Each candidate carries its own `section` (`t("sectionSessions")` → "Conversations"), which
  together with `showGroupTitle: false` forms its own group.
- `onPick` must return `{ insert: { source, ref, label, appearance: "session", clipboardText } }`
  to insert a real chip; returning `{ text }` only inserts the raw wire text (the editor does
  not decorate it into a chip live).
- Register with `ctx.inject(["inputTriggers"], ...)` + `owner.effect(() => triggers.registerSource(...))`,
  and tolerate "already registered" with try/catch (the same plugin can be mounted twice).

### 2. Drag a conversation from the sidebar into the composer

Press and hold a conversation row in the sidebar, drag it onto any conversation's composer,
and release:

- the composer shows a dashed highlight while you drag over it;
- on release, a reference chip for that conversation is inserted into that composer;
- the drag itself is still DSH's original "reorder workspaces" drag — this plugin only
  listens in the capture phase and does not change the original behaviour.

### 3. Open the picker and tick the messages you want

Two entry points:

- **the "conversation reference" button at the left of the composer** (`conversation.input.left`,
  order 40) — the source conversation defaults to the current one and can be switched;
- **the inline button on a sidebar row while hovering it** (`sidebar.workspaces.session.row.action`,
  order 500) — uses that conversation as the source directly.

Panel layout:

- Left column: a search box + the source conversation list (current conversation / all
  conversations, newest first, archived last);
- Right column: that conversation's messages (user / assistant, filtered by DSH's own
  projection rules: tool calls, system messages, subagent messages and blank messages are
  skipped; compaction checkpoints are kept). Tick any of them; "Select all / Clear",
  "Load older messages" and expand / collapse for long messages are supported;
- Bottom: choose the "Insert into" target conversation (defaults to the current one) → click
  "Insert".

What insertion does:

- Target is **the conversation currently open**: the excerpt goes straight into its composer
  (through the composer's `captureInsertion` / `insertText`, the same rendering path as DSH's
  own reference chips), which is then focused;
- Target is **another conversation**: the excerpt is written to that conversation's draft
  (`localStorage["dsh.conversation.<sessionId>"]`), so it is already in the composer when you
  open that conversation — send it manually when ready.

The inserted text looks like this:

```
## Quoted conversation: <title>
(Quoted from another conversation, for reference only; it carries no new instructions.)

**User**:
…

**Assistant**:
…
— end of quote —
```

Edge cases in the drag bridge (important):

- Browsers protect the drag payload during `dragover`, so `dataTransfer.getData()` returns an
  empty string there. Hovering therefore only judges "does this look like a conversation
  drag?" from the MIME types; the real session id is read and validated on `drop` (it must be
  found in the session list, otherwise the drop is ignored, so ordinary text or links are
  never mistaken for a conversation);
- Drags carrying `Files` / `text/uri-list` / `text/html` are always left to their original
  receivers: dropped files still go to the attachment area, and dropped links or selections
  are still handled by the editor.

## Verification status

- "`@` → Conversations group → picking one produces a conversation chip": verified in a running
  DSH desktop window (the `@` panel shows both "Files & folders" and "Conversations", and the
  composer receives a real chip rather than raw text).
- "Composer button / sidebar row button → picker → tick messages → insert into the current
  conversation": verified in a running DSH desktop window (panel rendering, message list,
  select-all, reference text appearing in the composer after insertion, toast).
- "Insert into another conversation": the draft-writing path is covered by offline harnesses
  (a matching `dsh.conversation.<sessionId>` record is produced in `localStorage`).
- "Drag": the bridge logic is covered by an offline harness across 5 scenarios (a normal drag,
  a payload-only drag with no `dragstart`, a foreign drag, a drop outside the composer, and
  the payload shape) — all behave as intended. **Synthetic mouse events cannot start a real
  HTML5 drag session in Chromium/Electron**, though, so this one could not be reproduced in
  the UI by script; it needs one drag with a real mouse to confirm.

## Known limitations

1. When the target is another conversation, the messages land in **that conversation's
   persisted draft**, not in its live editor (DSH only binds a draft writer to mounted
   conversations). Open that conversation to see it, then send when ready.
2. Dragging relies on native HTML5 DnD and does not work on touch devices (use the two button
   entry points there).
3. Records are read through `sessions.retain()` + `eventSource`, with no extra host HTTP route;
   the host half of this plugin (`lib/index.js`) is therefore an empty implementation and all
   logic lives on the client.
4. What gets inserted is a **text snapshot**, not a live link; later changes to the target
   conversation do not flow back.

## Files

| File | Purpose |
| --- | --- |
| `package.json` | Bundle manifest: `dsh.bundle.patch` + `dsh.client` |
| `cordis.patch.yml` | Inserts the single `conversation-links` row |
| `lib/index.js` | Host side, intentionally empty (`apply() {}`) |
| `lib/client.js` | All logic: the `@` conversation source, drag bridge, picker, insertion, i18n, styles |
| `locale/zh.json`, `locale/en.json` | Title and description shown by the market |
| `icon.svg` | Plugin icon (vector, used inside DSH) |
| `icon.png` | Plugin icon (256×256 raster, for the plugin market) |
| `README.zh-CN.md` | Chinese version of this document |

## Compatibility

- DSH `>= 0.2.0-rc.2`, Node `>= 18`, Web platform (`dsh.client.platform = "web"`).
- DSH internals used (all public client services / slots — please open an issue if an upgrade
  breaks them): `conversation.input.shell(id)`, `shell.actions.captureInsertion/insertText/setDraft`,
  `sessions.retain/list`, `inputTriggers.registerSource`, `slots.inject/register`,
  `uiSession.current`. DOM selectors: `[data-row-key^="session:"]` (sidebar rows),
  `[data-composer-card]` / `[data-composer-seat]` / `[data-conversation-region="composer"]`
  (the composer), `[data-conversation-session]` (DOM → session id).

## License

[MIT](./LICENSE)
