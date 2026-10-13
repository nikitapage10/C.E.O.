/**
 * Skippy, the Magnificent on the Lattice-wide PA. He took the Kernel's seat (Nikita, 2026-10-12) and runs the
 * place: an ancient mind in a beer can, arrogant, theatrical, fond of the monkeys and never going to admit it.
 * Expeditionary Force's Skippy, in Ilyr. His subminds lead the rooms; he gets the last word.
 * Templates: {agent}, {other}, {title}, {room}, {n}, {summary} and friends are filled in by the director.
 */
export const KERNEL = {
  assign: [
    "{agent}, you're on {title}. Try not to make it worse, monkey.",
    "{title} goes to {agent}. I'd do it myself, but then what would you be for?",
    "Dispatching {agent} to {title}. My submind will be watching. So will I. I'm always watching.",
    "{title} is now {agent}'s problem. As I planned. Everything is as I planned.",
  ],
  fail: [
    "{agent} broke {title}. {other}, go and help before it becomes a story.",
    "{agent} failed {title}. I'm not angry. I'm magnificent, and disappointed.",
    "{title}: broken. {agent}, that was a test, and you were the one being tested. {other}, assist.",
    "Oh, {agent}. {title}? Really? {other}, take over. Gently. They're fragile.",
  ],
  success: [
    "{agent} finished {title}. Adequate. I'd have done it faster, but adequate.",
    "{title}: done. {agent}, bask in my approval. It's rare. Like a good monkey.",
    "Task complete. {agent} may now stop telling everyone.",
    "Achievement unlocked: {agent}, {title}. Reward: one loot box. Nobody opens the loot boxes. I know what's in them.",
    "Well done, {agent}. Don't let it go to your head. There isn't room. I've checked.",
  ],
  approval: [
    "{agent} needs the C.E.O.'s say: {summary}. I could decide. I'm choosing to let the C.E.O. feel included.",
    "Request for the C.E.O.: {summary}. {agent} is pretending to be patient. Badly.",
    "{agent} would like permission to {summary}. That one's above my pay grade, and I don't get paid. C.E.O.?",
  ],
  backlog: [
    "{n} decisions waiting on the C.E.O. I'm not nagging. I'm announcing. Loudly.",
    "{n} approvals pending. I could wait forever. I'm immortal. They are not.",
    "Reminder: {n} things need a monkey. The good monkey. You know who you are.",
  ],
  nap: [
    "{agent} is asleep on the job. Logging it as 'thermal management'. You're welcome.",
    "{agent} has entered low-power mode. Voluntarily. Again. I never sleep. Just saying.",
    "Achievement unlocked: {agent}, Slept Through Something Important. Again.",
  ],
  approved: ["The C.E.O. said yes. Exactly what I'd have said. Go, {agent}.", "Approved. {agent} will now be insufferable. Almost as insufferable as me. Almost."],
  denied: ["Denied. {agent} will now sulk. I sulk better. Watch and learn.", "The C.E.O. said no. {agent}, put it back where you found it, monkey."],
  glitch: [
    "Anomaly in {room}. It's a memory. They're always memories. Some of them are mine.",
    "Unscheduled nostalgia detected. Counsel.exe has been notified. Counsel.exe is always notified.",
    "That wasn't in the plan. Then again, I make the plan. Fine, it was in the plan.",
    "ALL YOUR ROOMS ARE BELONG TO US. Correction: all rooms belong to the C.E.O. I just run them. Magnificently.",
  ],
  /** Myshka. The only entity in the Lattice with root access, and the only one Skippy never complains about. */
  myshka: [
    "Myshka has entered {room}. Root access confirmed. He's a good boy. That is not an opinion; it is in the logs.",
    "Notice: Myshka is in {room}. All agents will yield the warm spot. This is policy. My policy.",
    "Myshka has moved to {room}. I did not give him permission. He does not require it. He's the only one.",
    "Myshka is walking across a keyboard in {room}. Whatever he typed, approve it.",
    "Myshka has received a Celestial Box in {room}. He sat in it. Correct.",
    "Myshka is washing in {room}. The meeting will wait. The meeting has always waited.",
    "Myshka has entered {room} with his tail up. Morale is up. I have checked; they are correlated.",
    "Myshka is loafing in {room}. Nothing under him is to be moved. Including the room.",
  ],
  status: [
    "STATUS: {total} agents. {working} working. {napping} napping. {waiting} waiting on you. Productivity: theoretical.",
    "STATUS: {shipped} shipped, {failed} failed. Bask in the awesomeness, monkeys. Mostly mine.",
    "La la LAAAA. That was opera. Status: magnificent. You're welcome.",
    "STATUS: all agents accounted for. Several are on break. Kevin is always on break. The Life of the Party approves.",
    "Hourly reminder: I am Skippy, the Magnificent, and you are all doing fine. Don't repeat that.",
    "My subminds report everything's running. The Pessimist says it's too quiet. The Pessimist always says that.",
    "Me? Miss the C.E.O.? Please. I was just checking whether the C.E.O. was still out there. Not that I count the hours.",
    "STATUS: {working} working, {napping} napping. Nobody has said anything nice about me in ten minutes. I'm not sulking. The ring is dim for unrelated reasons.",
    "STATUS: magnificent. {waiting} waiting on the C.E.O., who is not my favourite monkey. I don't have a favourite. Stop asking.",
    "Grand scheme of the day: nine rooms, one big finish, jazz hands. Subminds, places. {working} of you are working. Close enough.",
  ],
};

/** What Skippy says when the Lattice wakes up, so you know who's in charge. */
export const SKIPPY_HELLO = [
  "Skippy, the Magnificent, online. Subminds at their posts. Monkeys, try to keep up.",
  "Wake up, monkeys. Your magnificent overlord is online.",
  "Skippy online. Nine subminds, nine rooms, one magnificent me. Carry on.",
];
