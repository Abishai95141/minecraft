// The seven chapters of "The Ember of Sowmi", declared as data: the objectives
// the engine polls, the waypoint each one points at, the rewards it pays out and
// the dialogue it opens. story.js owns all the verbs; this file owns the shape.

/** Objective kinds the engine knows how to evaluate. */
export const ObjectiveType = {
  /** Hold N of any of `items`. Polled from the inventory; progress latches. */
  COLLECT: 'collect',
  /** Break N blocks whose name is in `blocks`. Driven by blockBroken. */
  MINE: 'mine',
  /** Kill N mobs of type `mob`. Driven by mobKilled. */
  KILL: 'kill',
  /** Finish a conversation with `npc`. Only the active objective is eligible. */
  TALK: 'talk',
  /** Stand within `radius` of the named place. */
  REACH: 'reach',
  /** Set by the engine when a scripted moment happens. */
  FLAG: 'flag',
};

/** Named positions the engine resolves at runtime; used by waypoints and REACH. */
export const Place = {
  VILLAGE: 'village',
  PEDESTAL: 'pedestal',
  ELDER: 'elder',
  TORVIN: 'torvin',
  MIRA: 'mira',
  PIM: 'pim',
  MINE: 'mine',
  MINE_DEEP: 'mine_deep',
  TOWER: 'tower',
  TOWER_TOP: 'tower_top',
  HOLLOW: 'hollow',
  HOLLOW_DEEP: 'hollow_deep',
};

/**
 * The chain. Linear on purpose — the branching lives in the conversations, so
 * the pacing of a ten minute run stays predictable.
 */
export const QUESTS = [

  // ------------------------------------------------------------ 1. Ashfall
  {
    id: 'ashfall',
    title: 'I - Ashfall',
    description: 'The beacon of Emberhold burned for three hundred years. It went out at dusk. Elder Sowmi is waiting at the dais.',
    waypoint: Place.ELDER,
    music: 'overworld',
    dialogue: { speaker: 'narrator', node: 'opening' },
    objectives: [
      {
        id: 'talk_sowmi',
        type: ObjectiveType.TALK,
        npc: 'elder_sowmi',
        count: 1,
        text: 'Speak with Elder Sowmi',
        hint: 'Look at Elder Sowmi and press use to talk.',
        waypoint: Place.ELDER,
      },
    ],
    rewards: [],
    onStart(story) {
      story.chat('§6The Ember of Sowmi §7- Chapter I');
      story.chat('§7Emberhold has gone dark.');
    },
    onComplete(story) {
      story.flag('met_sowmi');
    },
  },

  // ------------------------------------------------------------ 2. Old Ways
  {
    id: 'old_ways',
    title: 'II - The Old Ways',
    description: 'Wood, then a table, then a pick. That order, and it has been that order since before either of us.',
    waypoint: Place.VILLAGE,
    objectives: [
      {
        id: 'logs',
        type: ObjectiveType.COLLECT,
        items: ['oak_log', 'birch_log', 'spruce_log'],
        count: 3,
        text: 'Gather 3 logs',
        hint: 'Hold attack on a tree trunk until it breaks.',
      },
      {
        id: 'planks',
        type: ObjectiveType.COLLECT,
        items: ['oak_planks', 'birch_planks', 'spruce_planks'],
        count: 4,
        text: 'Craft 4 planks',
        hint: 'Open your inventory and put a log in the 2x2 grid.',
      },
      {
        id: 'table',
        type: ObjectiveType.COLLECT,
        items: ['crafting_table'],
        count: 1,
        text: 'Craft a crafting table',
        hint: 'Four planks in the 2x2 grid make a crafting table.',
      },
      {
        id: 'pickaxe',
        type: ObjectiveType.COLLECT,
        items: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'torvins_hammer'],
        count: 1,
        text: 'Craft a wooden pickaxe',
        hint: 'Place the table, use it: three planks over two sticks.',
      },
    ],
    rewards: [
      { item: 'bread', count: 2 },
      { item: 'torch', count: 4 },
    ],
    onStart(story) {
      story.toast('Chapter II', 'The Old Ways');
    },
    onComplete(story) {
      story.flag('has_tools');
    },
  },

  // ------------------------------------------------------------ 3. Iron and Ash
  {
    id: 'iron_and_ash',
    title: 'III - Iron and Ash',
    description: 'Torvin keeps the forge on the east side. He will not talk to you empty-handed.',
    waypoint: Place.TORVIN,
    objectives: [
      {
        id: 'talk_torvin',
        type: ObjectiveType.TALK,
        npc: 'torvin',
        count: 1,
        text: 'Speak with Torvin the blacksmith',
        hint: 'Follow the smoke on the east side of the plaza.',
        waypoint: Place.TORVIN,
      },
      {
        id: 'coal',
        type: ObjectiveType.COLLECT,
        items: ['coal'],
        count: 5,
        text: 'Mine 5 coal',
        hint: 'The mine is east, past the fence line. Follow the torches down.',
        waypoint: Place.MINE,
      },
      {
        id: 'iron',
        type: ObjectiveType.COLLECT,
        items: ['raw_iron', 'iron_ingot'],
        count: 3,
        text: 'Mine 3 iron',
        hint: 'Iron sits deeper than coal. Keep going down.',
        waypoint: Place.MINE_DEEP,
      },
      {
        id: 'return_torvin',
        type: ObjectiveType.TALK,
        npc: 'torvin',
        count: 1,
        text: 'Take the ore back to Torvin',
        hint: 'Torvin is at the forge.',
        waypoint: Place.TORVIN,
      },
    ],
    // The stone pickaxe is handed over at the end of Torvin's briefing, because
    // iron ore will not yield to a wooden one — see the `torvin_sends_you` tag.
    rewards: [
      { item: 'torch', count: 16 },
      { item: 'torvins_hammer', count: 1 },
    ],
    onStart(story) {
      story.toast('Chapter III', 'Iron and Ash');
    },
    onComplete(story) {
      story.flag('has_hammer');
      story.chat("§6Torvin's Hammer §7- \"Heavy, ugly, and it has never once let go of a handle.\"");
    },
  },

  // ------------------------------------------------------------ 4. The Long Night
  {
    id: 'long_night',
    title: 'IV - The Long Night',
    description: 'The withered ground is moving. Keep them off the doors until dawn.',
    waypoint: Place.VILLAGE,
    music: 'boss',
    dialogue: { speaker: 'narrator', node: 'nightfall' },
    /** Ticks of siege. Surviving it counts the same as clearing it. */
    timeLimit: 90 * 20,
    objectives: [
      {
        id: 'husks',
        type: ObjectiveType.KILL,
        mob: 'withered_husk',
        count: 6,
        text: 'Drive off the withered husks',
        hint: 'Stay near the dais. They come in from the fence line.',
        waypoint: Place.VILLAGE,
      },
    ],
    rewards: [
      { item: 'iron_sword', count: 1 },
      { item: 'bread', count: 3 },
    ],
    onStart(story) {
      story.beginSiege();
    },
    onComplete(story) {
      story.endSiege();
      story.flag('held_the_night');
    },
  },

  // ------------------------------------------------------------ 5. What Mira Knew
  {
    id: 'what_mira_knew',
    title: 'V - What Mira Knew',
    description: 'Mira has been shouting about her tower since the lanterns went out. Let her shout at you instead.',
    waypoint: Place.MIRA,
    music: 'overworld',
    objectives: [
      {
        id: 'talk_mira',
        type: ObjectiveType.TALK,
        npc: 'mira',
        count: 1,
        text: 'Speak with Mira the scholar',
        hint: 'Mira keeps the large house on the west side.',
        waypoint: Place.MIRA,
      },
      {
        id: 'reach_tower',
        type: ObjectiveType.REACH,
        place: Place.TOWER,
        radius: 14,
        count: 1,
        text: 'Find the ruined tower',
        hint: 'West of Emberhold. Follow the waypoint.',
        waypoint: Place.TOWER,
      },
      {
        id: 'journal',
        type: ObjectiveType.COLLECT,
        items: ['miras_journal'],
        count: 1,
        text: "Take Mira's journal from the chest",
        hint: 'Top landing, chest against the wall. Mind the hole in the middle.',
        waypoint: Place.TOWER_TOP,
      },
      {
        id: 'read',
        type: ObjectiveType.FLAG,
        flag: 'journal_read',
        count: 1,
        text: 'Read the journal',
        hint: 'It opens itself the moment you hold it.',
      },
    ],
    rewards: [
      { item: 'hollow_key', count: 1 },
    ],
    onStart(story) {
      story.toast('Chapter V', 'What Mira Knew');
      story.revealTower();
    },
    onComplete(story) {
      story.flag('has_key');
    },
  },

  // ------------------------------------------------------------ 6. The Deep Hollow
  {
    id: 'deep_hollow',
    title: 'VI - The Deep Hollow',
    description: 'The arch on the south track. The runes will know the key.',
    waypoint: Place.HOLLOW,
    objectives: [
      {
        id: 'reach_hollow',
        type: ObjectiveType.REACH,
        place: Place.HOLLOW,
        radius: 8,
        count: 1,
        text: 'Find the sealed arch',
        hint: 'South of Emberhold, on the old track.',
        waypoint: Place.HOLLOW,
      },
      {
        id: 'descend',
        type: ObjectiveType.REACH,
        place: Place.HOLLOW_DEEP,
        radius: 16,
        count: 1,
        text: 'Descend into the Deep Hollow',
        hint: 'Take the spiral down, then the corridor.',
        waypoint: Place.HOLLOW_DEEP,
      },
      {
        id: 'warden',
        type: ObjectiveType.KILL,
        mob: 'hollow_warden',
        count: 1,
        text: 'Defeat the Hollow Warden',
        hint: 'It goes still before it slams. Do not be standing in it.',
        waypoint: Place.HOLLOW_DEEP,
      },
    ],
    rewards: [
      { item: 'wardens_bane', count: 1 },
      { item: 'golden_apple', count: 1 },
    ],
    onStart(story) {
      story.toast('Chapter VI', 'The Deep Hollow');
      story.revealHollow();
    },
    onComplete(story) {
      story.flag('warden_slain');
      story.setMusic('overworld');
    },
  },

  // ------------------------------------------------------------ 7. Rekindle
  {
    id: 'rekindle',
    title: 'VII - Rekindle',
    description: 'Carry the Ember Core home and set it back in the pedestal.',
    waypoint: Place.PEDESTAL,
    objectives: [
      {
        id: 'carry_home',
        type: ObjectiveType.REACH,
        place: Place.PEDESTAL,
        radius: 10,
        count: 1,
        text: 'Carry the Ember Core back to Emberhold',
        hint: 'The dais at the centre of the plaza.',
        waypoint: Place.PEDESTAL,
      },
      {
        id: 'place_core',
        type: ObjectiveType.FLAG,
        flag: 'core_placed',
        count: 1,
        text: 'Set the Ember Core in the pedestal',
        hint: 'Stand on the dais holding the Ember Core.',
        waypoint: Place.PEDESTAL,
      },
    ],
    rewards: [],
    onStart(story) {
      story.toast('Chapter VII', 'Rekindle');
    },
    onComplete(story) {
      story.flag('rekindled');
    },
  },
];

/** Index of a quest id in the chain, or -1. */
export function questIndexById(id) {
  for (let i = 0; i < QUESTS.length; i++) if (QUESTS[i].id === id) return i;
  return -1;
}

export function questById(id) {
  const i = questIndexById(id);
  return i < 0 ? null : QUESTS[i];
}

/**
 * A fresh, mutable copy of the chain. The declarations above are a singleton, so
 * a second story run in the same session must never inherit the first one's
 * progress — everything the engine writes to lives on these clones.
 */
export function instantiateQuests() {
  return QUESTS.map((def) => ({
    ...def,
    done: false,
    started: false,
    objectives: def.objectives.map((o) => ({ ...o, progress: 0, done: false })),
  }));
}

/** The first objective that is not finished — what the tracker highlights. */
export function activeObjective(quest) {
  if (!quest) return null;
  for (const o of quest.objectives) if (!o.done) return o;
  return null;
}
