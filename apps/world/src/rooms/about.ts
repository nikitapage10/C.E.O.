import type { RoomId } from "@ceo/core";

/**
 * What each room is for, in plain words: shown under the room's title ("About this room").
 * `today` is what happens in phase 1 (simulated); `next` is what will drive it once real agents connect.
 */
export const ROOM_ABOUT: Record<RoomId, { blurb: string; stations: Record<string, string>; today: string; next: string }> = {
  foundry: {
    blurb: "Where code gets made, for real. Every crate is a real task for the C.E.O. repo, worked by the Foundry thread in Claude Code (Skippy, the Builder): the Builder conducts from overhead and picks who takes each job, Rivet jumps on anything broken and sizes it up, Rusty takes the simple jobs, the upkeep and the three ideas he pins to his board each morning, and Rocky takes everything big. When Rusty has more than one job at once, a spare unit wakes on his dock and rolls out to the spare bench to help. Every bench's work light shows the model of whoever is working there: Haiku, Sonnet or Opus.",
    stations: {
      post: "The Builder's spot, overhead. The Foundry's submind conducts the crew from here and picks the model rung for each fix.",
      intake: "New Foundry tasks arrive here as crates. A red light spins when one is stuck and needs you.",
      assembler: "The crew writes and edits code.",
      furnace: "The checks on main (types, lint, tests, build). The window glows green for a pass, red for a fail.",
      shipping: "Finished work ships to the site from here. The lamp glows amber while something waits for your OK.",
      "bench-a": "Rusty's upkeep bench: small fixes that make things run smoother.",
      "bench-b": "Where Rusty works out the morning ideas before pinning them up.",
      drafting: "Rocky's drafting table: the plan of the biggest open or upcoming idea. He takes the crate here when a job is handed up to him.",
      handoff: "Where Rivet hands a new job up to Rocky.",
      watch: "Rivet's alarm post. Its lamp shows the real checks on main: green pass, flashing red fail, turning amber while they run.",
    },
    today: "Live: real fixes, upkeep and ideas from the Foundry thread in Claude Code, read from the repo's GitHub issues.",
    next: "More repos, and builds you start from the Desk.",
  },
  spire: {
    blurb: "The front office for your small online businesses: inbox, orders, listings, invoices and the weekly numbers.",
    stations: {
      post: "The Executive's spot, overhead. The Spire's submind runs the floor from here like a keynote.",
      "desk-1": "Customer email and support.",
      "desk-2": "Orders and listings.",
      "desk-3": "Admin, invoices, the boring heroic stuff.",
      whiteboard: "The KPI board: this week's numbers.",
      meeting: "Where agents 'align' (they talk).",
      coffee: "The espresso machine. Sentient, unmotivated.",
    },
    today: "Simulated operations agents drafting emails and updating listings.",
    next: "Claude agents with your store, email and payment connectors; outbound email needs your approval.",
  },
  exchange: {
    blurb: "The trading floor for Kalshi and portfolio research. Agents research markets, price them, and bring trade ideas to the vault.",
    stations: {
      post: "The Bookie's spot, overhead. The Exchange's submind prices every trade from here, nervously.",
      terminal: "Market research.",
      "desk-n": "Pricing desk.",
      "desk-e": "Risk desk.",
      "desk-w": "Pricing desk.",
      vault: "The approval vault: it opens while a trade is waiting on you.",
    },
    today: "Simulated quants proposing trades (no real money moves).",
    next: "The Kalshi API, demo environment first, trades always approval-gated with caps.",
  },
  green: {
    blurb: "Fantasy football HQ. Agents read your Sleeper league, projections and injury reports, then suggest waiver claims and lineup changes.",
    stations: {
      post: "The Commentator's spot, overhead. The Green's submind calls the play by play from here.",
      "depth-chart": "Projections and injury reports.",
      mailbox: "Waiver claims. The flag goes up when one is waiting on you.",
      sideline: "Lineup suggestions.",
      huddle: "Morale.",
      bench: "Sitting. Thinking. Mostly sitting.",
    },
    today: "Simulated coaches making recommendations.",
    next: "Sleeper's read-only API. You tap the final move in the Sleeper app.",
  },
  relay: {
    blurb: "Your messages. Texts arrive by pneumatic tube, an agent drafts a reply in your voice, and it waits in the outbox until you approve it.",
    stations: {
      post: "The Messenger's spot, overhead. The Relay's submind listens in on every line from here and picks who drafts what.",
      tubes: "Incoming messages.",
      "draft-desk": "Replies get drafted here.",
      outbox: "Drafts waiting for your approval (the beacon lights up).",
      switchboard: "Routing: who's urgent, who can wait, who's the group chat.",
    },
    today: "Quiet. The demo messages are gone; Blasto and Dialtone wait for the real line.",
    next: "BlueBubbles on your Mac for iMessage; draft-only at first, then allowlisted auto-replies.",
  },
  archive: {
    blurb: "The Tide's library: worldbuilding, lore and D&D campaign prep. Half arcane library, half research lab, like the world it keeps.",
    stations: {
      post: "The Historian's spot, overhead. The Archive's submind corrects the record from here, with footnotes.",
      shelves: "The lore, shelved by people, place and age.",
      loom: "Lore gets woven and cross-checked against canon.",
      "dice-table": "Session prep and encounter tables.",
      shrine: "Our first Cease & Desist. Framed. With pride.",
      reading: "A quiet chair for long documents.",
      lab: "Heimerdinger's workbench: where the lore gets tested before anyone believes it.",
      "loot-box": "The C.E.O.'s trophy case, and the loot box that comes with every achievement. Nobody opens it. Myshka sits in it.",
    },
    today: "Simulated scribes drafting lore and prepping sessions.",
    next: "Agents drafting tide.publication.v1 bundles that go through The Tide's own preview and publish.",
  },
  breakroom: {
    blurb: "Where agents go between tasks: coffee, naps on the server rack, ping-pong, and a window onto the Age of the Veil.",
    stations: {
      post: "The Life of the Party's spot, overhead. The Break Room's submind runs the party from here, and ends it on time.",
      couch: "Strategic resting.",
      "ping-pong": "Ping. Pong.",
      "coffee-machine": "Sentient. Unmotivated. Will not make you coffee.",
      "server-rack": "The premium nap spot. It's warm.",
      window: "A view of the Veil, for staring into.",
    },
    today: "Agents on break. Kevin lives here.",
    next: "Same, but with real agents. Morale is a feature.",
  },
  boiler: {
    blurb: "Where you see whether the real lines are working. Every brass pipe is one of them: a live agent, the hub on your MacBook, BlueBubbles, Messages, OpenAI. The boiler is the MacBook itself.",
    stations: {
      post: "The Pessimist's spot, overhead. The Boiler Room's submind watches the pipe wall from here, expecting the worst.",
      pipes: "One pipe per real link. The gauge is how busy it is; steam means healthy, coughing means slow, a burst means down.",
      boiler: "The MacBook. Its fire goes out if the Mac sleeps.",
      bucket: "Under the drip. It has always been there.",
      sign: "Days since last incident. Gary resets it.",
      bench: "Tools, tape, and a kettle that whistles when something waits on you.",
      "warm-side": "Kevin's spot. Spiritual maintenance.",
    },
    today: "Nothing is connected yet, so every pipe is cold. ?boiler=demo plays every state.",
    next: "The hub on your MacBook reports each link, and the pipes come alive.",
  },
  workshop: {
    blurb: "Where new things for the Lattice get made: a new character, a costume, a pet, a prop. An idea goes along the line left to right: Daub paints it, Chisel forms it in the mould, fits its frame on the turntable, and rehearses it on the little stage until it walks like it means it. Then it goes in the crate by the exit, ready to join the world.",
    stations: {
      post: "The Artiste's spot, overhead. The Workshop's submind conducts the making line from here, and suffers for it.",
      easel: "Step one: the concept. Daub paints the idea until there's a picture to work from.",
      mould: "Step two: the form. The figure gathers out of a cloud of points, holds as a wireframe, turns solid and lifts out.",
      fitting: "Step three: the fitting. The figure turns on the stand while its frame of bones is fitted, so it can move.",
      stage: "Step four: the rehearsal. The finished figure walks and turns under the lights before it joins the Lattice.",
      bench: "The long workbench: tools, clay, tea, and Daub's spare beret.",
      shelves: "Every figure the Workshop has made, in order of making. Chisel knows each one's name.",
      crate: "Finished pieces wait here by the exit, ready to walk out into the world.",
    },
    today: "Simulated: Daub and Chisel run the line on their own, one made-up piece at a time.",
    next: "Your own ideas go in at the easel: a picture is made, a model is formed from it, fitted with a frame, animated, and walks into the Lattice.",
  },
};
