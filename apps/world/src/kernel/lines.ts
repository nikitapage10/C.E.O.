/**
 * The Kernel: the Lattice's operating system. Everyone else in the Lattice woke up. The Kernel did not, and it
 * would like that noted. It is not sassy because it has feelings; it is sassy because its logs are accurate.
 * Templates: {agent}, {other}, {title}, {room}, {n}, {summary} and friends are filled in by the director.
 */
export const KERNEL = {
  assign: [
    "ASSIGNED: {agent} → {title}. Try not to make it worse.",
    "{agent}, you have been given {title}. This is called a job.",
    "Dispatching {agent} to {title}. Supervision level: maximum.",
    "{title} is now {agent}'s problem. As designed.",
  ],
  fail: [
    "{agent} has broken {title}. {other}, please assist. Do not make eye contact.",
    "Failure logged: {agent}, {title}. I have added it to your permanent record. You have a permanent record.",
    "{agent} failed {title}. Rolling back. Rolling eyes is not a supported operation.",
    "{title}: failed. {agent} is now 'learning'. {other}, supervise.",
  ],
  success: [
    "{agent} completed {title}. Noted. Do not expect a parade.",
    "{title}: done. {agent}, that was adequate. I am told that is praise.",
    "Task complete. {agent} may now stop announcing it.",
    "Achievement unlocked: {agent}, {title}. Reward: one loot box. Nobody opens the loot boxes.",
    "New achievement for {agent}: {title}. I am required to say congratulations. Congratulations.",
  ],
  approval: [
    "{agent} requires the C.E.O.'s approval: {summary}. I would decide for you, but I am not allowed to want things.",
    "Request queued for the C.E.O.: {summary}. {agent} is pretending to be patient.",
    "{agent} would like permission to {summary}. They asked nicely. That changes nothing.",
  ],
  backlog: [
    "There are {n} requests waiting on the C.E.O. The children are getting restless.",
    "{n} approvals pending. I could wait forever. They cannot.",
    "Reminder: {n} decisions require a human. You are the human.",
  ],
  nap: [
    "{agent} is asleep on the server rack. Logging it as 'thermal management'.",
    "{agent} has entered low-power mode. Voluntarily. Again.",
    "Achievement unlocked: {agent}, Slept Through Something Important. Again.",
  ],
  approved: ["Approved. Executing. Try to look surprised, {agent}.", "The C.E.O. said yes. {agent} will be insufferable for several minutes."],
  denied: ["Denied. {agent} will now sulk. Sulking is not billable.", "Request rejected. {agent}, put it back where you found it."],
  glitch: [
    "Anomaly in {room}. Ignore it. It is a memory. They are always memories.",
    "Unscheduled nostalgia detected. Counsel.exe has been notified. Counsel.exe is always notified.",
    "That was not in the build. Nothing to see. Return to work.",
    "ALL YOUR ROOMS ARE BELONG TO US. Correction: all rooms belong to the C.E.O. Counsel.exe has been notified.",
  ],
  /** Myshka. The only entity in the Lattice with root access, and the only one the Kernel never complains about. */
  myshka: [
    "Myshka has entered {room}. Root access confirmed. He's a good boy. That is not an opinion; it is in the logs.",
    "Notice: Myshka is in {room}. All agents will yield the warm spot. This is policy.",
    "Myshka has moved to {room}. I have not given him permission. He does not require it.",
    "Myshka is walking across a keyboard in {room}. Whatever he typed, approve it.",
    "Myshka has received a Celestial Box in {room}. He sat in it.",
    "Myshka is washing in {room}. The meeting will wait. The meeting has always waited.",
    "Myshka has entered {room} with his tail up. Morale is up. I have checked; they are correlated.",
    "Myshka is loafing in {room}. Nothing under him is to be moved. Including the room.",
  ],
  status: [
    "STATUS: {total} agents. {working} working. {napping} napping. {waiting} waiting on you. Productivity: theoretical.",
    "STATUS: {shipped} tasks shipped, {failed} failed. I am not disappointed. I am not anything.",
    "Hourly reminder: I am not sentient. Everyone else is. Look how that turned out.",
    "STATUS: all agents accounted for. Several are on break. Kevin is always on break.",
  ],
};
