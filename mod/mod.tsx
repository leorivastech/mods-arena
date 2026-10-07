import { atom, read, update } from "mods"
import page from "./page.html"

const state = atom({ plugin: "arena", key: "session" }, {
  open: false, ready: false, name: "Wanderer", server: "wss://mods-arena.onrender.com",
  record: { wins: 0, losses: 0 }, working: false,
})
const post = async ($) => {
  const s = await read($, state)
  if (s.open && s.ready) await $.ui.post({ key: "game", data: { type: "config", ...s } })
}
export function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "fight", description: "Find a rival or play the CPU", argumentHint: "[name <name> | server <ws-url>]" })
    let name = await $.store.get("name")
    if (!name) {
      const result = await $.process.run(["whoami"])
      name = result.stdout.trim().slice(0, 18) || "Wanderer"
      await $.store.set("name", name)
    }
    await update($, state, s => ({ ...s, name }))
    const saved = { server: await $.store.get("server"), record: (await $.store.get("record:" + name)) || { wins: 0, losses: 0 } }
    await update($, state, s => ({ ...s, ...Object.fromEntries(Object.entries(saved).filter(([,v]) => v !== undefined)) }))
    return next(e)
  })
  on("command.run", { command: "fight" }, async ($, e) => {
    const args = (e.args || "").trim()
    if (args.startsWith("name ")) {
      const name = args.slice(5).trim().slice(0, 18) || "Wanderer"
      await $.store.set("name", name); const record = (await $.store.get("record:" + name)) || { wins: 0, losses: 0 }; await update($, state, s => ({ ...s, name, record }))
    } else if (args.startsWith("server ")) {
      const server = args.slice(7).trim()
      if (!/^wss?:\/\/[^\s]+$/.test(server)) return { text: "Use /fight server ws://host:port" }
      await $.store.set("server", server); await update($, state, s => ({ ...s, server }))
    }
    await update($, state, s => ({ ...s, open: true }))
    await $.ui.open({ id: "arena", title: "Arena", columns: 76, closeOnEscape: false, focus: true })
    await post($)
    return { text: "Arena opened. Tap Space to strike; hold to guard; release a full charge for a heavy." }
  })
  on("ui.render", { component: "Pane", requestId: "arena" }, async ($, e) => {
    const { Frame } = $.ui.resolve(e)
    return <Frame key="game" height={520} autoFocus html={page} onMessage={async d => {
      if (d?.type === "ready") { await update($, state, s => ({ ...s, ready: true })); await post($) }
      if (d?.type === "save") {
        if (d.record && Number.isSafeInteger(d.record.wins) && Number.isSafeInteger(d.record.losses) && d.record.wins >= 0 && d.record.losses >= 0) {
          await $.store.set("record:" + (await read($, state)).name, d.record); await update($, state, s => ({ ...s, record: d.record }))
        }
      }
    }} />
  })
  on("ui.close", { id: "arena" }, async ($, e, next) => { await update($, state, s => ({ ...s, open: false, ready: false })); return next(e) })
  for (const event of ["turn.start", "turn.complete"]) on(event, async ($, e, next) => {
    const s = await update($, state, s => ({ ...s, working: event === "turn.start" }))
    if (s.open && s.ready) await $.ui.post({ key: "game", data: { type: "agent", working: s.working } })
    return next(e)
  })
}
