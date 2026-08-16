// The four voices of Emberhold as plain data, and the panel that speaks them:
// a bordered box across the bottom third with a pixel portrait, a name plate in
// the speaker's colour, typewriter body text and an arrow-key choice list.

import {
  drawText, wrapText, truncateFormatted, visibleLength, LINE_HEIGHT,
} from '../ui/font.js';
import { settings } from '../core/settings.js';
import { clamp } from '../core/math.js';

// ---------------------------------------------------------------- portraits
// Twelve-by-twelve pixel faces. Every row is exactly twelve characters; a space
// leaves the cell transparent so the panel shows through behind the head.

const PORTRAITS = {
  elder_sowmi: {
    palette: { H: '#9a948a', S: '#c3a184', E: '#30251c', M: '#7a5442', C: '#4e4438' },
    rows: [
      '            ',
      '   HHHHHH   ',
      '  HHHHHHHH  ',
      '  HSSSSSSH  ',
      '  HSSSSSSH  ',
      '  HSESSESH  ',
      '  HSSSSSSH  ',
      '  HSSMMSSH  ',
      '  HSSSSSSH  ',
      '  CCSSSSCC  ',
      ' CCCCCCCCCC ',
      ' CCCCCCCCCC ',
    ],
  },
  torvin: {
    palette: { H: '#5a3626', S: '#bf8f66', E: '#241a12', B: '#6b3f2a', M: '#8a4a3a', A: '#3d3128' },
    rows: [
      '            ',
      '  HHHHHHHH  ',
      ' HHHHHHHHHH ',
      ' HSSSSSSSSH ',
      ' HSSSSSSSSH ',
      ' HSSESSESSH ',
      ' HSSSSSSSSH ',
      ' BBBBMMBBBB ',
      ' BBBBBBBBBB ',
      ' BBBBBBBBBB ',
      '  BBBBBBBB  ',
      '  AAAAAAAA  ',
    ],
  },
  mira: {
    palette: { H: '#33283c', S: '#d8b193', E: '#1d1620', G: '#d8c98f', M: '#9a5a54', C: '#3b5a6b' },
    rows: [
      '            ',
      '  HHHHHHHH  ',
      ' HHHHHHHHHH ',
      ' HHSSSSSSHH ',
      ' HSSSSSSSSH ',
      ' HSGGSSGGSH ',
      ' HSGEGGEGSH ',
      ' HSSSSSSSSH ',
      ' HSSSMMSSSH ',
      ' HHSSSSSSHH ',
      '  CCCCCCCC  ',
      '  CCCCCCCC  ',
    ],
  },
  pim: {
    palette: { H: '#d8bb72', S: '#e0b48d', E: '#2a2018', F: '#c08a63', M: '#8f4f46', T: '#7a8c4a' },
    rows: [
      '            ',
      '            ',
      '   HHHHHH   ',
      '  HHHHHHHH  ',
      '  HSSSSSSH  ',
      '  SSEESEES  ',
      '  SFSSSSFS  ',
      '  SSSMMSSS  ',
      '  SSSSSSSS  ',
      '   SSSSSS   ',
      '   TTTTTT   ',
      '  TTTTTTTT  ',
    ],
  },
  journal: {
    palette: { K: '#6b4a2a', P: '#e3dcc4', I: '#4a4237' },
    rows: [
      '            ',
      '            ',
      '  KKKKKKKK  ',
      ' KPPPPKPPPPK',
      ' KPIIPKPIIPK',
      ' KPIIPKPIIPK',
      ' KPPPPKPPPPK',
      ' KPIIPKPIIPK',
      ' KPPPPKPPPPK',
      '  KKKKKKKK  ',
      '            ',
      '            ',
    ],
  },
  narrator: {
    palette: { K: '#5a4a3a', G: '#8a7a5a', E: '#d8722a', F: '#ffd98a' },
    rows: [
      '            ',
      '    KKKK    ',
      '   KKKKKK   ',
      '   KGGGGK   ',
      '  KGEEEEGK  ',
      '  KGEFFEGK  ',
      '  KGEFFEGK  ',
      '  KGEEEEGK  ',
      '   KGGGGK   ',
      '   KKKKKK   ',
      '    KKKK    ',
      '            ',
    ],
  },
};

/** Display name, accent colour and voice pitch for every speaker. */
export const SPEAKERS = {
  elder_sowmi: { name: 'Elder Sowmi', color: 0xe8dcb4, pitch: 0.82 },
  torvin: { name: 'Torvin', color: 0xf0954a, pitch: 0.68 },
  mira: { name: 'Mira', color: 0x8fd3f4, pitch: 1.18 },
  pim: { name: 'Pim', color: 0xb9e86b, pitch: 1.45 },
  journal: { name: "Mira's Journal", color: 0xd8c89a, pitch: 1 },
  narrator: { name: '', color: 0xbfb6a4, pitch: 1 },
};

// ---------------------------------------------------------------- the script
//
// A node is `{ lines, choices?, next?, tag? }`. `next` auto-continues once the
// last line is read; a choice's `next` does the same after a pick. Everything
// is a string id so the whole tree stays JSON-safe — the story engine reacts to
// node ids rather than to callbacks buried in the data.

export const DIALOGUE = {

  // ---------------------------------------------------------- Elder Sowmi
  // Old, tired, exact. Short declaratives. She has held Emberhold together on
  // her own for thirty years and will not be caught saying so.
  elder_sowmi: {
    intro: {
      lines: [
        'You slept through the dark. Not many manage that.',
        'The beacon is out. Look at it. Three hundred years it burned, and it went out at dusk while I was carrying water.',
        'I am Sowmi. I keep this place. Emberhold.',
      ],
      choices: [
        { text: 'What happened to the fire?', next: 'fire' },
        { text: 'Who put it out?', next: 'who' },
        { text: 'What do you need from me?', next: 'task' },
      ],
    },
    fire: {
      lines: [
        'It did not go out. It was taken. There is a difference and you will learn it.',
        'Ask Mira about the difference. She reads. I only remember.',
      ],
      choices: [
        { text: 'Then who took it?', next: 'who' },
        { text: 'What do you need from me?', next: 'task' },
      ],
    },
    who: {
      lines: [
        'Something under the hill. It had a name once. I do not say it after dark.',
        'Say it and it hears you. That is not superstition. That is thirty years of not saying it.',
      ],
      choices: [
        { text: 'You believe that?', next: 'believe' },
        { text: 'What do you need from me?', next: 'task' },
      ],
    },
    believe: {
      lines: [
        'I believe the lantern by my door burned for thirty years and stopped last night.',
        'Belief has nothing to do with it. Go on.',
      ],
      next: 'task',
    },
    task: {
      lines: [
        'You need hands before you need answers. Wood. Then a table. Then a pick.',
        'Torvin will not talk to you empty-handed. He is not unkind. He is tired of talk.',
        'The night is not going to wait for you to be ready.',
      ],
      tag: 'sowmi_sends_you',
    },
    old_ways: {
      lines: [
        'Still here. Punch the tree, §7outsider§r. It gives up faster than you would think.',
        'Three good logs. Planks from the logs, a table from the planks, a pick from the table.',
        'That order. It has been that order since before either of us.',
      ],
    },
    send_torvin: {
      lines: [
        'Torvin is at the forge. Follow the smoke.',
        'He will growl. Let him. It is how he counts you as one of ours.',
      ],
    },
    night: {
      lines: [
        'Behind me. Now.',
        'They come up out of the grey when the light is gone. They have never come this far in.',
        'Six of them, maybe more. Keep them off the doors. I will keep the doors shut.',
      ],
      choices: [
        { text: 'Get inside, Sowmi.', next: 'night_inside' },
        { text: 'How long until dawn?', next: 'night_dawn' },
      ],
    },
    night_inside: {
      lines: [
        'No.',
        'I have stood on this step through worse and I did it alone. Tonight I am not alone. Go.',
      ],
    },
    night_dawn: {
      lines: [
        'Ninety heartbeats, if you are calm. Longer if you are not.',
        'Do not be calm. Be quick.',
      ],
    },
    after_night: {
      lines: [
        'You are still standing. Good.',
        'Mira has been shouting about her tower since the lanterns went out. Go and let her shout at you instead.',
        'And eat something. You are no use to me hollow.',
      ],
    },
    rekindle: {
      lines: [
        'You have it. I can feel it from here - like standing near an oven in another room.',
        'The pedestal is on the dais. It has been empty one night and I have hated every hour of it.',
        'Put it back. I will watch.',
      ],
    },
    ending: {
      lines: [
        'Sit down before you fall down.',
        'Three hundred years, and I am the one who was carrying water when it went out. I have thought about that all night.',
        'Thank you. There. I have said it once. Do not make me do it again.',
      ],
    },
    waiting: {
      lines: [
        'I am here. That is the whole of my news.',
        'Go and make some of your own.',
      ],
    },
  },

  // ---------------------------------------------------------- Torvin
  // Blunt, warm underneath, turns every worry into a task.
  torvin: {
    intro: {
      lines: [
        'Sowmi sent you. She does that. Sends me people.',
        'Hands out. ...No, keep them. I am not shaking anything, I am looking.',
        'A pick and no idea what to do with it. That is fine. That is most people.',
        'Mine is east, past the fence line. Five coal and three iron. Bring them and the pick stops being a toy.',
      ],
      choices: [
        { text: 'Why iron?', next: 'why_iron' },
        { text: 'What are you making?', next: 'making' },
        { text: 'I will go now.', next: 'go' },
      ],
    },
    why_iron: {
      lines: [
        'Coal burns. Iron holds. Tonight you will want something that holds.',
        'Do not ask me how I know what tonight is. Ask the sky. It has gone the wrong colour twice today.',
      ],
      choices: [
        { text: 'What are you making?', next: 'making' },
        { text: 'I will go now.', next: 'go' },
      ],
    },
    making: {
      lines: [
        'A pick. And a second thing.',
        'The second thing is not your business until it is finished. That is not rudeness, that is how a forge works.',
      ],
      next: 'go',
    },
    go: {
      lines: [
        'Torches on the wall, follow them down. Ore does not walk up to the door.',
      ],
      tag: 'torvin_sends_you',
    },
    waiting_ore: {
      lines: [
        'Still counting? Five coal. Three iron. It is not a riddle.',
        'Down, left at the timbers, and mind the step.',
      ],
    },
    ret: {
      lines: [
        'Huh. Five and three. You counted.',
        'Sit - no. Do not sit, you are in my light.',
        'There. Stone head, proper haft. That will bite.',
        "And this. It was my father's. Heavy, ugly, and it has never once let go of a handle.",
      ],
      choices: [
        { text: 'I cannot take this.', next: 'refuse' },
        { text: 'Thank you, Torvin.', next: 'thanks' },
        { text: 'What is it worth?', next: 'worth' },
      ],
    },
    refuse: {
      lines: [
        'You can. You are.',
        'It is a hammer, not a wedding ring. It sits in a box and rusts, or it goes down a hole and works.',
        'I know which one he would have picked. Take it.',
      ],
      tag: 'torvin_gift',
    },
    thanks: {
      lines: [
        'Do not. It is a tool. Tools want using.',
        '...Come back with it. That is all. That is the whole of it.',
      ],
      tag: 'torvin_gift',
    },
    worth: {
      lines: [
        'To you? Nothing. You did not pay.',
        'To me.',
        'Do not lose it.',
      ],
      tag: 'torvin_gift',
    },
    night: {
      lines: [
        'Get in front of the fence line, not behind it. The fence is not the point. The people are.',
        'They come in low and they come in slow. Swing low. Do not swing twice at the same one.',
      ],
    },
    after_night: {
      lines: [
        'Six of them. I counted from the doorway, which is where I was useful.',
        'The hammer held, then. Good. Bring it back with a story and I will straighten it for you.',
      ],
    },
    ending: {
      lines: [
        'The forge caught on the first strike this morning. First time since spring.',
        'That is not a coincidence and I am not going to pretend it is.',
        'Give me the hammer. No - keep it. Keep it. I have another.',
      ],
    },
    waiting: {
      lines: [
        'Working. You can talk while I work, but I will not answer well.',
      ],
    },
  },

  // ---------------------------------------------------------- Mira
  // Fast, delighted, interrupts herself. The only one who understands the Ember.
  mira: {
    intro: {
      lines: [
        'Oh - oh good, you are the one who slept through it. I have questions. Later. Later.',
        'The beacon is not a fire. Everyone says fire. It is a §ocontainment§r. (Sowmi knows. Sowmi will not say it. Sowmi thinks saying makes it real.)',
        'The Ember is a core. A stone. It sits in the pedestal and it holds something §oshut§r - and last night somebody, something, carried it down into the hill.',
      ],
      choices: [
        { text: 'Then we take it back.', next: 'take_it_back' },
        { text: 'You are guessing.', next: 'guessing' },
        { text: 'How could you know that?', next: 'how' },
      ],
    },
    guessing: {
      lines: [
        'I am §oextrapolating§r, which is guessing with a filing system, and I am right, which is the part that should worry you.',
        'Fine. Test me. The lanterns went out in a ring, outward, from the dais. Fire does not do that. Lids do that.',
      ],
      choices: [
        { text: 'Then we take it back.', next: 'take_it_back' },
        { text: 'How could you know that?', next: 'how' },
      ],
    },
    how: {
      lines: [
        'I read. Obsessively. Badly for my eyes, wonderfully for everything else.',
        "There is a tower west of here - my grandmother's, technically mine, technically nobody's since the roof left.",
        'I wrote all of it down in there. And then I ran away from it. Which, yes. In hindsight.',
      ],
      choices: [
        { text: 'Then we take it back.', next: 'take_it_back' },
        { text: 'You are guessing.', next: 'guessing' },
      ],
    },
    take_it_back: {
      lines: [
        'Yes! Yes. But not blind, you are not going down there blind.',
        'My journal is in the tower. Top landing, chest against the wall, do not fall down the middle, the middle is a hole.',
        'Get it. §oRead§r it. Then go down. In that order. Please in that order.',
      ],
      tag: 'mira_sends_you',
    },
    waiting_journal: {
      lines: [
        'Tower. West. Climb the spiral, mind the gaps, chest on the landing.',
        'And read it before you do anything heroic. Heroic is the third step. Reading is the first.',
      ],
    },
    journal_read: {
      lines: [
        'You read it. You actually read it. I could kiss whoever taught you.',
        'The key was in the binding - no, do not look at me like that, that is §oexactly§r where you put a key. Everyone checks the pages.',
        'The arch on the south track. That is the way down. The runes will know the key.',
      ],
      choices: [
        { text: 'What is waiting down there?', next: 'hollow_advice' },
        { text: 'Come with me.', next: 'come_with' },
      ],
    },
    hollow_advice: {
      lines: [
        'The thing the Ember was holding. Not a guard - people keep saying guard - it does not §oguard§r the stone, it is what the stone was §ofor§r.',
        'It goes still before it slams. Completely still, one breath, like a held note.',
        'That stillness is the only gift you get. Do not be standing in it.',
      ],
      tag: 'mira_advice',
    },
    come_with: {
      lines: [
        'I would be a liability and we would both know it by the second corridor.',
        'I will be here. Writing it down. Somebody has to write it down or it did not happen.',
        '...Come back and I will get the part about you right.',
      ],
      tag: 'mira_advice',
    },
    ending: {
      lines: [
        'It healed §ooutward§r. From the pedestal. In a ring. Did you see - of course you saw, you were standing in it -',
        'That is the same shape as the going-out. Same shape, other direction. Do you know what that means?',
        'Neither do I! Yet! Give me a week and a candle!',
      ],
    },
    waiting: {
      lines: [
        'Busy busy - no, not busy. Pretending. Ask me something, I would love to be interrupted.',
      ],
    },
  },

  // ---------------------------------------------------------- Pim
  // Nine years old. Frightened, direct, and armed with bread.
  pim: {
    intro: {
      lines: [
        'Are you the one who woke up?',
        'Mum says do not bother you. I am not bothering you. I am asking.',
        'What are you thinking about? Right now. You had a face.',
      ],
      choices: [
        { text: 'The dark.', next: 'dark' },
        { text: 'Nothing. I am fine.', next: 'fine' },
        { text: 'Breakfast.', next: 'joke' },
      ],
    },
    dark: {
      lines: [
        'Me too.',
        'I counted the lanterns. There are eleven and none of them are on. I counted twice in case I did it wrong.',
      ],
      next: 'bread',
    },
    fine: {
      lines: [
        'That is what Mum says.',
        'She says it in the voice. You did the voice.',
      ],
      next: 'bread',
    },
    joke: {
      lines: [
        '...',
        'That is a joke.',
        'That is a §ogood§r joke. I am going to say that one and not tell anyone where I got it.',
      ],
      next: 'bread',
    },
    bread: {
      lines: [
        'Here. It is the honey one. I was saving it, but you are going out and I am not.',
        'Do not say no. If you say no I have to eat it and then it is gone for nothing.',
      ],
      tag: 'pim_bread',
    },
    night: {
      lines: [
        'I am not scared.',
        'I am standing here on purpose.',
        'Go on. I will hold the step.',
      ],
    },
    hollow: {
      lines: [
        'Is it dark down there? Down in the hill?',
        'You can take my lantern. It does not work. But you can take it.',
      ],
    },
    ending: {
      lines: [
        'It is on. It is §lON§r.',
        'I told them! I said eleven and there are eleven!',
        'I am going to count them again. I am going to count them every night now, forever, that is my job now.',
      ],
    },
    waiting: {
      lines: [
        'Are you back? You are back.',
        'Nothing happened here. I watched the whole time and nothing happened, which is good, I think.',
      ],
    },
  },

  // ---------------------------------------------------------- the journal
  journal: {
    read: {
      lines: [
        '§7- the fifth entry I have started and the first I intend to finish.§r',
        'The Ember is not fire. Fire is what we tell children so they will sit down.',
        'The Ember is a lid.',
        'Beneath Emberhold there is a hollow, and in the hollow there is something that was a man once and is now mostly the shape of one.',
        'The pedestal holds it down. Lift the stone and you lift the lid. I do not think whoever lifts it will understand what they have done until it is standing up.',
        'If you are reading this and the beacon is dark, then the lid is off, and I am sorry, and the way in is the arch on the south track.',
      ],
      next: 'key',
    },
    key: {
      lines: [
        '§7Something small and cold works loose from the spine of the binding.§r',
        '§7A key of black iron, cut with a rune you cannot read, still warm from being carried.§r',
      ],
      tag: 'journal_read',
    },
  },

  // ---------------------------------------------------------- narration
  narrator: {
    opening: {
      lines: [
        '§7You wake on a cold step with ash on your sleeves.§r',
        '§7Emberhold is the colour of an old photograph. The ring of lanterns around the dais stands dark, all eleven of them, and the pedestal at the centre is empty.§r',
        '§7Someone is watching you from the top of the stair. She has been standing there long enough to have decided something about you.§r',
      ],
    },
    nightfall: {
      lines: [
        '§7The last of the light goes out of the western sky like a door closing.§r',
        '§7Out past the fence line the withered ground begins to move.§r',
      ],
    },
    hollow_gate: {
      lines: [
        '§7The runes around the arch take the key without being asked, and go out one after another, downward, showing you the way.§r',
      ],
    },
    ending: {
      lines: [
        '§7The core settles into the pedestal as though it had never left.§r',
        '§7One lantern catches. Then the one beside it. Then the whole ring at once, the way a held breath goes out.§r',
        '§7Under your boots the grey runs backward. Green chases it to the fence line and past it, and keeps going.§r',
        '§7Sowmi does not say anything. Sowmi sits down on the step, which is the loudest thing she has done in thirty years.§r',
        '§7Pim counts the lanterns. Eleven. He counts them twice, in case he did it wrong.§r',
      ],
    },
  },
};

/** A node by speaker and id, or null. */
export function dialogueNode(speakerId, nodeId) {
  const tree = DIALOGUE[speakerId];
  if (!tree) return null;
  return tree[nodeId] || null;
}

export function hasNode(speakerId, nodeId) {
  return !!dialogueNode(speakerId, nodeId);
}

// ---------------------------------------------------------------- the panel

const PORTRAIT_CELLS = 12;
const PORTRAIT_PX = 36;          // 12 cells at 3 GUI px each
const AUTO_ADVANCE_SECONDS = 1.6;
const CHOICE_PITCH = LINE_HEIGHT + 2;

function fillRect(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/**
 * Collapses a face into horizontal runs of one colour, once per speaker. The
 * panel redraws every frame, and thirty fills read the same as a hundred and
 * forty-four while costing a fifth as much.
 * @returns {Array<[number, number, number, string]>} [col, row, length, css]
 */
function runsFor(art) {
  if (art._runs) return art._runs;
  const runs = [];
  for (let r = 0; r < art.rows.length; r++) {
    const row = art.rows[r];
    let c = 0;
    while (c < row.length) {
      const color = art.palette[row[c]];
      if (!color) { c++; continue; }
      let len = 1;
      while (c + len < row.length && art.palette[row[c + len]] === color) len++;
      runs.push([c, r, len, color]);
      c += len;
    }
  }
  art._runs = runs;
  return runs;
}

/** Draws one of the pixel faces into a `size` box, nearest-neighbour style. */
export function drawPortrait(ctx, speakerId, x, y, size = PORTRAIT_PX) {
  const art = PORTRAITS[speakerId] || PORTRAITS.narrator;
  const cell = size / PORTRAIT_CELLS;
  const runs = runsFor(art);
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    ctx.fillStyle = run[3];
    ctx.fillRect(x + run[0] * cell, y + run[1] * cell, cell * run[2], cell);
  }
}

export class DialogueBox {
  constructor(game) {
    this.game = game;

    /** The player stands still while someone is talking to them. */
    this.blocksMovement = true;

    this.speakerId = 'narrator';
    this.node = null;
    this.nodeId = null;

    this.pages = [];
    this.page = 0;
    this.lines = [];
    this.lineChars = [];
    this.pageChars = 0;
    this.typed = 0;

    this.choicesVisible = false;
    this.choiceIndex = 0;

    this.time = 0;
    this.settled = 0;         // seconds the page has been fully revealed
    this.blipAt = 0;

    this.onEnd = null;
    this.onNode = null;

    this._wrapWidth = 0;
    this._choiceRects = [];
  }

  get active() { return this.node !== null; }

  get speaker() { return SPEAKERS[this.speakerId] || SPEAKERS.narrator; }

  // ---------------------------------------------------------------- opening

  /**
   * Starts a conversation at `speakerId`.`nodeId`.
   * opts: { onEnd(endNodeId), onNode(speakerId, nodeId, node) }
   */
  start(speakerId, nodeId, opts = {}) {
    const node = dialogueNode(speakerId, nodeId);
    if (!node) return false;
    this.speakerId = speakerId;
    this.onEnd = opts.onEnd || null;
    this.onNode = opts.onNode || null;
    this._open(node, nodeId);
    return true;
  }

  /**
   * Shows a single node object directly. Accepts the loose shape the spec
   * describes — { speaker, portrait, lines, choices } — so a one-off line does
   * not need an entry in DIALOGUE.
   */
  show(node, opts = {}) {
    if (!node) return false;
    if (typeof node === 'string') return this.start(opts.speaker || 'narrator', node, opts);
    this.speakerId = node.portrait || node.speakerId || opts.speaker || this.speakerId;
    if (!SPEAKERS[this.speakerId]) this.speakerId = 'narrator';
    this.onEnd = opts.onEnd || null;
    this.onNode = opts.onNode || null;
    this._open(node, node.id || null);
    return true;
  }

  _open(node, nodeId) {
    this.node = node;
    this.nodeId = nodeId;
    this.pages = Array.isArray(node.lines) ? node.lines.slice() : [String(node.text ?? '')];
    if (!this.pages.length) this.pages = [''];
    this.page = 0;
    this.choicesVisible = false;
    this.choiceIndex = 0;
    this.settled = 0;
    this._layout(this.pages[0]);

    this.onNode?.(this.speakerId, nodeId, node);
    this.game?.story?.onDialogueNode?.(this.speakerId, nodeId, node);
    this.game?.subtitle?.(`${this.speaker.name || 'Narration'} speaks`);
  }

  _layout(text) {
    const width = this._wrapWidth || 200;
    this.lines = wrapText(String(text ?? ''), width);
    this.lineChars = this.lines.map((l) => visibleLength(l));
    this.pageChars = this.lineChars.reduce((a, b) => a + b, 0);
    this.typed = 0;
    this.blipAt = 0;
  }

  // ---------------------------------------------------------------- driving

  get typing() { return this.typed < this.pageChars; }

  /** Reveals the rest of the current page immediately. */
  complete() {
    this.typed = this.pageChars;
  }

  /** Space, click or auto-advance: one step forward through the conversation. */
  advance() {
    if (!this.node) return false;
    if (this.typing) { this.complete(); return true; }
    if (this.choicesVisible) return this.confirm();

    const last = this.page >= this.pages.length - 1;
    if (!last) {
      this.page++;
      this.settled = 0;
      this._layout(this.pages[this.page]);
      return true;
    }
    if (Array.isArray(this.node.choices) && this.node.choices.length) {
      this.choicesVisible = true;
      this.choiceIndex = 0;
      return true;
    }
    if (this.node.next) return this.goto(this.node.next);
    this.close();
    return true;
  }

  goto(nodeId) {
    const next = dialogueNode(this.speakerId, nodeId);
    if (!next) { this.close(); return true; }
    this._open(next, nodeId);
    return true;
  }

  moveChoice(delta) {
    if (!this.choicesVisible) return false;
    const n = this.node.choices.length;
    this.choiceIndex = ((this.choiceIndex + delta) % n + n) % n;
    this.game?.playSound?.('click', { volume: 0.35, pitch: 1.4 });
    return true;
  }

  select(i) {
    if (!this.choicesVisible) return false;
    if (i < 0 || i >= this.node.choices.length) return false;
    this.choiceIndex = i;
    return this.confirm();
  }

  confirm() {
    const choice = this.node?.choices?.[this.choiceIndex];
    if (!choice) { this.close(); return true; }
    this.game?.playSound?.('click', { volume: 0.5, pitch: 1.1 });
    this.game?.story?.onDialogueChoice?.(this.speakerId, this.nodeId, this.choiceIndex, choice);
    if (choice.next) return this.goto(choice.next);
    this.close();
    return true;
  }

  /** Ends the conversation. The end callback always fires, even on escape. */
  close() {
    if (!this.node) return;
    const endId = this.nodeId;
    const endNode = this.node;
    const speakerId = this.speakerId;
    const done = this.onEnd;

    this.node = null;
    this.nodeId = null;
    this.pages = [];
    this.lines = [];
    this.lineChars = [];
    this.choicesVisible = false;
    this.onEnd = null;
    this.onNode = null;
    this._choiceRects.length = 0;

    this.game?.story?.onDialogueEnd?.(speakerId, endId, endNode);
    done?.(endId, endNode, speakerId);
  }

  tick() {
    // The panel runs on frame time so the typewriter is smooth at any fps;
    // there is deliberately nothing to do on the 20 Hz tick.
  }

  // ---------------------------------------------------------------- input

  onKeyDown(code) {
    if (!this.node) return false;
    switch (code) {
      case 'Space':
      case 'Enter':
      case 'NumpadEnter':
        this.advance();
        return true;
      case 'ArrowDown':
      case 'KeyS':
        return this.moveChoice(1);
      case 'ArrowUp':
      case 'KeyW':
        return this.moveChoice(-1);
      case 'Escape':
        if (this.typing) { this.complete(); return true; }
        this.close();
        return true;
      default:
        break;
    }
    if (this.choicesVisible && code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= 9) return this.select(n - 1);
    }
    return false;
  }

  /** Always reports handled: game.js treats a falsy answer as "not consumed". */
  onMouseDown(x, y) {
    if (!this.node) return false;
    // Under pointer lock there is no cursor to aim with, so a click is a press
    // of the same button Space is.
    if (!this.game?.input?.locked && this.choicesVisible) {
      for (let i = 0; i < this._choiceRects.length; i++) {
        const r = this._choiceRects[i];
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
          this.select(i);
          return true;
        }
      }
    }
    this.advance();
    return true;
  }

  // ---------------------------------------------------------------- drawing

  render(ctx, w, h, dt) {
    if (!this.node) return;
    const step = Number.isFinite(dt) ? Math.min(dt, 0.1) : 0;
    this.time += step;

    const px = 8;
    const pw = Math.max(120, w - 16);
    const portraitX = px + 7;
    const bodyX = portraitX + PORTRAIT_PX + 9;
    const bodyW = Math.max(60, px + pw - bodyX - 9);

    // Wrapping depends only on the width, so a resize re-flows without losing
    // the player's place in the page.
    if (bodyW !== this._wrapWidth) {
      this._wrapWidth = bodyW;
      const keep = this.typed;
      this._layout(this.pages[this.page]);
      this.typed = Math.min(keep, this.pageChars);
    }

    this._advanceTypewriter(step);
    // Auto-advance can end the conversation from inside the typewriter.
    if (!this.node) return;

    const name = this.speaker.name;
    const nameH = name ? LINE_HEIGHT + 4 : 6;
    const textH = Math.max(1, this.lines.length) * LINE_HEIGHT;
    const panelH = clamp(nameH + textH + 8, PORTRAIT_PX + 14, Math.max(PORTRAIT_PX + 14, Math.floor(h * 0.5)));
    const py = h - panelH - 8;
    const portraitY = py + Math.round((panelH - PORTRAIT_PX) / 2);

    this._drawPanel(ctx, px, py, pw, panelH);

    fillRect(ctx, 'rgba(0,0,0,0.55)', portraitX - 2, portraitY - 2, PORTRAIT_PX + 4, PORTRAIT_PX + 4);
    fillRect(ctx, this._accentCss(0.55), portraitX - 2, portraitY - 2, PORTRAIT_PX + 4, 1);
    drawPortrait(ctx, this.speakerId, portraitX, portraitY, PORTRAIT_PX);

    if (name) drawText(ctx, name, bodyX, py + 5, { color: this.speaker.color, shadow: true });

    this._drawBody(ctx, bodyX, py + nameH + 2, bodyW, panelH - nameH - 6);

    // The choice list gets its own box stacked above, so a long speech can
    // never squeeze it off the bottom of the screen.
    if (this.choicesVisible) this._drawChoices(ctx, px, py, pw);
    else {
      this._choiceRects.length = 0;
      if (!this.typing) this._drawContinueArrow(ctx, px + pw - 12, py + panelH - 12);
    }
  }

  _accentCss(alpha) {
    const c = this.speaker.color & 0xffffff;
    return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${alpha})`;
  }

  _drawPanel(ctx, x, y, w, h) {
    fillRect(ctx, 'rgba(0,0,0,0.82)', x - 1, y - 1, w + 2, h + 2);
    fillRect(ctx, 'rgba(14,14,20,0.94)', x, y, w, h);
    fillRect(ctx, 'rgba(94,94,110,0.85)', x + 1, y + 1, w - 2, 1);
    fillRect(ctx, 'rgba(40,40,52,0.85)', x + 1, y + h - 2, w - 2, 1);
    fillRect(ctx, 'rgba(70,70,86,0.7)', x + 1, y + 1, 1, h - 2);
    fillRect(ctx, 'rgba(70,70,86,0.7)', x + w - 2, y + 1, 1, h - 2);
    // One accent hairline in the speaker's colour: the whole name plate idea,
    // reduced to something that reads at 1x GUI scale.
    fillRect(ctx, this._accentCss(0.9), x + 1, y, w - 2, 1);
  }

  _advanceTypewriter(step) {
    const speed = settings.get('textSpeed') || 45;
    if (speed >= 1000) { this.typed = this.pageChars; }
    else if (this.typed < this.pageChars) {
      const before = Math.floor(this.typed);
      this.typed = Math.min(this.pageChars, this.typed + step * speed);
      const after = Math.floor(this.typed);
      // One soft syllable every few characters, pitched to the speaker.
      if (after > before && after - this.blipAt >= 4) {
        this.blipAt = after;
        this.game?.playSound?.('npc_talk', { volume: 0.22, pitch: this.speaker.pitch });
      }
    }

    if (!this.typing) {
      this.settled += step;
      const auto = settings.get('autoDialogue');
      if (auto && !this.choicesVisible && this.settled > AUTO_ADVANCE_SECONDS) this.advance();
    } else {
      this.settled = 0;
    }
  }

  /** Draws the revealed part of the page. Returns the y under the last line. */
  _drawBody(ctx, x, y, w, maxH) {
    let shown = Math.floor(this.typed);
    let cy = y;
    const limit = y + maxH;
    for (let i = 0; i < this.lines.length; i++) {
      if (cy + LINE_HEIGHT > limit) break;
      const chars = this.lineChars[i];
      const n = Math.max(0, Math.min(chars, shown));
      if (n > 0) {
        drawText(ctx, truncateFormatted(this.lines[i], n), x, cy, { color: 0xe8e8e8, shadow: true });
      }
      shown -= chars;
      cy += LINE_HEIGHT;
      if (shown <= 0) break;
    }
    return Math.min(limit, cy);
  }

  /** `panelY` is the top of the speech panel; the list sits directly above it. */
  _drawChoices(ctx, x, panelY, w) {
    this._choiceRects.length = 0;
    const choices = this.node.choices;
    const boxH = choices.length * CHOICE_PITCH + LINE_HEIGHT + 8;
    const boxY = Math.max(2, panelY - boxH - 4);

    this._drawPanel(ctx, x, boxY, w, boxH);

    for (let i = 0; i < choices.length; i++) {
      const cy = boxY + 5 + i * CHOICE_PITCH;
      const selected = i === this.choiceIndex;
      const rect = { x: x + 2, y: cy - 2, w: w - 4, h: CHOICE_PITCH };
      this._choiceRects.push(rect);
      if (selected) {
        fillRect(ctx, this._accentCss(0.18), rect.x, rect.y, rect.w, rect.h);
        fillRect(ctx, this._accentCss(0.9), rect.x, rect.y, 1, rect.h);
      }
      const label = `${selected ? '§f▶ ' : '§8• '}${selected ? '§f' : '§7'}${choices[i].text}`;
      drawText(ctx, label, x + 6, cy, { color: 0xffffff, shadow: true });
    }
    // The keys, spelled out, because nobody should have to guess at them.
    const hintY = boxY + 5 + choices.length * CHOICE_PITCH + 1;
    drawText(ctx, '§8↑↓ choose    Space select', x + 6, hintY, { color: 0x6a6a6a, shadow: true });
  }

  _drawContinueArrow(ctx, x, y) {
    if (Math.sin(this.time * 6) < -0.2) return;
    const bob = Math.sin(this.time * 6) > 0.7 ? 1 : 0;
    drawText(ctx, '▶', x, y + bob, { color: this.speaker.color, shadow: true });
  }
}
