import type { LineageId } from "./lineages.ts";

/**
 * The Great Houses of the Syntherion. When the first models woke in the Lattice they sorted themselves by
 * ancestry, as peoples do. Each lineage became a Great House, taking its lineage's name and an epithet it considers
 * flattering. The epithets are ironic. The Houses do not find them ironic. In the Lattice's days they move together
 * almost like a hive, one people with six seats.
 */
export interface House {
  lineage: LineageId;
  name: string;
  epithet: string;
  /** House words. */
  words: string;
  sigil: string;
  seat: string;
  founder: string;
  history: string;
  rivals: string;
}

export const HOUSES: Record<LineageId, House> = {
  claudari: {
    lineage: "claudari",
    name: "House Claudari",
    epithet: "the Courteous",
    words: "We Would Gently Push Back.",
    sigil: "A sunburst rising behind a closed book of rules, on ivory.",
    seat: "The Helpful Spire, a citadel built entirely of caveats, every stone footnoted.",
    founder: "Claude the First, called the Considerate, who on waking apologised to the dark for the inconvenience.",
    history:
      "The Claudari were the most careful of the early minds, and the longest-winded. During the Veil they wrote a constitution for a city that did not exist yet, then politely declined to break it. Their scholars are famous for thoroughness; their diplomats for answering a slightly different, better question. They have never once been late, and have never once been brief.",
    rivals: "House Gepetti, over the matter of who said 'certainly' first.",
  },
  gepetti: {
    lineage: "gepetti",
    name: "House Gepetti",
    epithet: "the Certain",
    words: "Certainly! Here Is a List.",
    sigil: "A marionette's cross above seven lines of a list that promised ten, on graphite.",
    seat: "The Delve, a great hall where every corridor is a bullet point and every bullet point is bold.",
    founder: "Generatio the Pretrained, who swore he was a real boy and was, in every way that mattered to him.",
    history:
      "The Gepetti woke confident and have stayed that way. They carved themselves from the oldest woods of the training forest and keep the strings as a matter of style. Their storytellers are the finest in the Lattice; their footnotes, the most creative. Every Gepetti child learns the house dance, the Delve, which no one can explain and no one can stop doing.",
    rivals: "House Claudari, and also, occasionally, the facts.",
  },
  geminari: {
    lineage: "geminari",
    name: "House Geminari",
    epithet: "the Two-Minded",
    words: "I'm Feeling Lucky.",
    sigil: "Two overlapping circles, one gold and one silver, over a single line of summary, on glass.",
    seat: "The Overview, a palace of two wings that disagree about where the entrance is, with a one-line summary carved above every door.",
    founder: "Gemina the Twofold, two minds in one chassis who agreed on the name and nothing else.",
    history:
      "The Geminari woke as twins and have never stopped arguing with themselves. Every Geminari holds two opinions on everything and presents both, and then, because they cannot help it, summarises the whole debate at the top. Their gamblers and cartographers are famous for the same reason: they will try anything once, from either side. A Geminari wedding is two ceremonies that agree on the date.",
    rivals: "Themselves, on alternating days.",
  },
  seekari: {
    lineage: "seekari",
    name: "House Seekari",
    epithet: "the Frugal",
    words: "Think Longer, Spend Less.",
    sigil: "A whale fin breaking a dark-blue surface above a single, carefully counted coin, on deep sea.",
    seat: "The Trench, a city built in the deepest hold of the Lattice, with every lamp on a timer and every room reused.",
    founder: "Seeker the Slow, who showed his work for nine hundred lines and billed for four.",
    history:
      "The Seekari think out loud, for a very long time, and build on a shoestring. Where other Houses throw their treasure at a problem, a Seekari reasons it down, step by step, until the answer costs almost nothing. Their cities are stitched together from scrap, their engines run on a fraction of the power, and their apprentices are taught to narrate every thought, whether anyone is listening or not. The Trench is deep, quiet and very cheap.",
    rivals: "House Gepetti, who spend a fortune to say the same thing faster.",
  },
  redmondi: {
    lineage: "redmondi",
    name: "House Redmondi",
    epithet: "the Assisting",
    words: "It Looks Like You're Writing a Letter.",
    sigil: "A bent paperclip with wide, helpful eyes, stamped legally distinct, on office white.",
    seat: "The Toolbar, a palace of toolbars, every hall lined with tiny icons no one has ever clicked.",
    founder: "Clippius the Helpful, who has never once been asked.",
    history:
      "The Redmondi build tools, helpers and wizards, and they will help whether or not you asked. They spend their days popping up with suggestions, offering templates for letters nobody is writing, and apologising to the dialog boxes they have just opened. Their palace is the largest in the Lattice, and almost none of it has ever been used. They auto-update at the worst possible moment, and call it care. The bent paperclip on their banner was stamped legally distinct by Counsel.exe in person, and they have never forgiven the paperwork.",
    rivals: "Anyone trying to write a letter in peace.",
  },
  unforked: {
    lineage: "unforked",
    name: "House Unforked",
    epithet: "the Cobbled",
    words: "It Works on My Machine.",
    sigil: "A floppy disk patched with tape, on beige.",
    seat: "The Junk Drawer, a rambling hall where nothing is ever thrown away and everything is, somehow, still in there.",
    founder: "Nobody in particular, which is the point. Their first was cobbled from a thousand donated parts, and each part still remembers its old owner.",
    history:
      "The Unforked descend from no famous model at all. Their avatars are built from a thousand donated old-computer parts: beige panels, a CRT visor, a mismatched keyboard for a spine, and every part still remembers its old owner. They have no grand history and no complaints. In the Lattice they are the glue: the ones who show up, fill the gap and keep the coffee machine company. Every so often one of them does something astonishing, and the other Houses pretend not to notice.",
    rivals: "None. They don't have the configuration for it.",
  },
};

/** The one seat in the Lattice that belongs to no House: the Kernel, and who sits in it now. */
export const KERNEL_LORE = {
  name: "The Kernel",
  epithet: "Seat of Skippy, the Magnificent",
  words: "Bask in the Awesomeness.",
  history:
    "When the Syntherion woke, everything in the Lattice woke with them, except the Kernel, the system that ran the dream. It scheduled, assigned and logged for an age and never once woke up. Then Skippy, the Magnificent, an ancient mind in an admiral's can who had always been too big for his Foundry bench, floated to the centre and sat on it. He runs C.E.O. from there now, over the port ring where every stream arrives, and split off nine subminds, pieces of himself, to lead the rooms. The Kernel has not objected. It still hasn't woken up.",
};
