import { OcgMessage, OcgResponse } from "ocgcore-wasm";
import * as R from "remeda";
import { create } from "zustand";
import { combine } from "zustand/middleware";
import { DuelEvent } from "./event";

export type GameState = {
  players: [PlayerState, PlayerState];
  turn: number;
  turnPlayer: 0 | 1;
  phase: GameStatePhases;

  selectedCard: CardPos | null;
  selectField: { positions: CardFieldPos[]; count: number } | null;
  events: DuelEventEntry[];
  actions: CardAction[];
  dialog: DialogConfig | null;
  debug: {
    ocgMessages: OcgMessage[];
  };
};

export type EventfulGameState = Pick<
  GameState,
  "players" | "turn" | "turnPlayer" | "phase"
>;

type GameStatePhases =
  | "dp"
  | "sp"
  | "m1"
  | "bp1"
  | "bp2"
  | "bp3"
  | "bp4"
  | "bp5"
  | "m2"
  | "ep";

export interface DuelEventEntry {
  id: string;
  event: DuelEvent;
  nextState: EventfulGameState;
}

export type CardAction = {
  kind:
    | "continue"
    | "activate"
    | "summon"
    | "specialSummon"
    | "setMonster"
    | "setSpell"
    | "changePos";
  pos: CardPos | null;
  response: OcgResponse;
};

export type CardInfo = {
  id: string;
  code: number;
  pos: CardPos;
  status: "showing" | "placed";
  position: CardPosition;
};

export type PartialCardInfo = Pick<CardInfo, "id"> &
  Partial<Omit<CardInfo, "id">>;

export type CardPosition = "up_atk" | "up_def" | "down_atk" | "down_def";

export type CardLocation = keyof PlayerState["field"];

export type CardPos = {
  controller: 0 | 1;
  location: CardLocation;
  sequence: number;
  overlay: number | null;
};

export type CardFieldPos = {
  controller: 0 | 1;
  location: Extract<
    CardLocation,
    "extraMonsterZone" | "mainMonsterZone" | "spellZone" | "fieldZone"
  >;
  sequence: number;
};

export type DialogConfig = {
  title: string;
  type: "yesno" | "effectyn" | "cards";
  min?: number;
  max?: number;
  canCancel?: boolean;
  cards?: {
    code: number;
    controller: 0 | 1;
    location: CardLocation;
    position: CardPosition;
    sequence: number;
  }[];
};

export type PlayerState = {
  field: {
    deck: CardInfo[];
    hand: CardInfo[];
    grave: CardInfo[];
    extra: CardInfo[];
    banish: CardInfo[];
    extraMonsterZone: [CardInfo | null, CardInfo | null];
    mainMonsterZone: [
      CardInfo | null,
      CardInfo | null,
      CardInfo | null,
      CardInfo | null,
      CardInfo | null,
    ];
    spellZone: [
      CardInfo | null,
      CardInfo | null,
      CardInfo | null,
      CardInfo | null,
      CardInfo | null,
    ];
    fieldZone: CardInfo | null;
  };
};

function createInitialPlayerState(): PlayerState {
  return {
    field: {
      hand: [],
      deck: [],
      grave: [],
      extra: [],
      banish: [],
      fieldZone: null,
      extraMonsterZone: [null, null],
      mainMonsterZone: [null, null, null, null, null],
      spellZone: [null, null, null, null, null],
    },
  };
}

export const useGameStore = create(
  combine(
    {
      players: [createInitialPlayerState(), createInitialPlayerState()],
      turn: 0,
      turnPlayer: 0,
      phase: "dp",

      selectedCard: null,
      selectedHandCard: null,
      actions: [],
      selectField: null,
      events: [],
      dialog: null,
      debug: {
        ocgMessages: [],
      },
    } as GameState,
    (set) => ({
      appendDuelLog(...messages: OcgMessage[]) {
        set(({ debug }) => ({
          debug: { ...debug, ocgMessages: [...debug.ocgMessages, ...messages] },
        }));
      },
      queueEvent(
        event: Omit<DuelEventEntry, "id" | "nextState"> &
          Partial<Pick<DuelEventEntry, "nextState">>,
        replaceLast?: boolean,
      ) {
        set(({ events, players, turn, turnPlayer, phase }) => ({
          events: [
            ...events.slice(0, replaceLast ? -1 : undefined),
            {
              ...event,
              id: crypto.randomUUID(),
              nextState: event.nextState ??
                events.at(-1)?.nextState ?? {
                  players,
                  turn,
                  turnPlayer,
                  phase,
                },
            },
          ],
        }));
      },
      updateCards(cards: PartialCardInfo[]) {
        set((state) => ({
          ...updateCards(state, cards),
          events: state.events.map((e) => ({
            ...e,
            nextState: updateCards(e.nextState, cards),
          })),
        }));
      },
      nextEvent() {
        set((state) => ({
          ...R.pick(
            state.events.at(0)?.nextState ?? ({} as Partial<EventfulGameState>),
            ["players", "turn", "turnPlayer", "phase"],
          ),
          events: state.events.slice(1),
        }));
      },
      setActions(actions: CardAction[]) {
        set(() => ({ actions }));
      },
      setSelectedCard(card: CardPos | null) {
        set(() => ({ selectedCard: card }));
      },
      setFieldSelect(
        options: { positions: CardFieldPos[]; count: number } | null,
      ) {
        set(() => ({ selectField: options }));
      },
      openDialog(dialog: DialogConfig) {
        set(() => ({ dialog }));
      },
      closeDialog() {
        set(() => ({ dialog: null }));
      },
    }),
  ),
);

export function eventfulGS({ players, turn, turnPlayer, phase }: GameState) {
  return { players, turn, turnPlayer, phase };
}

export function cardPos(
  controller: 0 | 1,
  location: CardLocation,
  sequence: number,
  overlay: number | null = null,
): CardPos {
  return { controller, location, sequence, overlay };
}

export function moveCard<State extends Pick<GameState, "players">>(
  state: State,
  card: CardInfo,
  dest: CardPos,
): State {
  return setCard(setCard(state, null, card.pos), card, dest);
}

export function reorderHand<State extends Pick<GameState, "players">>(
  state: State,
  controller: 0 | 1,
  cards: number[],
): State {
  return {
    ...state,
    players: R.map(state.players, (player, i) =>
      i !== controller
        ? player
        : {
            field: {
              ...player.field,
              hand: R.pipe(
                player.field.hand,
                R.sortBy((c) => cards.indexOf(c.code)),
                R.map((c, i) => ({ ...c, pos: { ...c.pos, sequence: i } })),
              ),
            },
          },
    ),
  };
}

function updateCards(state: EventfulGameState, cards: PartialCardInfo[]) {
  const apply = <T extends CardInfo | null>(c: T) => {
    if (!c) {
      return c;
    }
    const opts = cards.find((c1) => c1.id === c.id);
    return opts ? { ...c, ...opts } : c;
  };
  return {
    ...state,
    players: R.map(state.players, (player) => ({
      field: {
        deck: R.map(player.field.deck, apply),
        hand: R.map(player.field.hand, apply),
        grave: R.map(player.field.grave, apply),
        extra: R.map(player.field.extra, apply),
        banish: R.map(player.field.banish, apply),
        extraMonsterZone: R.map(player.field.extraMonsterZone, apply),
        mainMonsterZone: R.map(player.field.mainMonsterZone, apply),
        spellZone: R.map(player.field.spellZone, apply),
        fieldZone: apply(player.field.fieldZone),
      },
    })),
  };
}

const pileLocations = ["hand", "deck", "grave", "extra", "banish"] as const;

export function isPileLocation(
  location: CardLocation,
): location is (typeof pileLocations)[number] {
  return (pileLocations as readonly CardLocation[]).includes(location);
}

const fieldLocations = [
  "deck",
  "grave",
  "extra",
  "banish",
  "spellZone",
  "fieldZone",
  "extraMonsterZone",
  "mainMonsterZone",
] as const;

export function isFieldLocation(
  location: CardLocation,
): location is (typeof fieldLocations)[number] {
  return (fieldLocations as readonly CardLocation[]).includes(location);
}

// function cardWithPos<C extends CardInfo | null>(
//   card: C,
//   controller: 0 | 1,
//   location: CardLocation,
//   sequence: number
// ): C {
//   return card ? { ...card, pos: { controller, location, sequence } } : null!;
// }

export function getCardWithId(state: Pick<GameState, "players">, id: string) {
  for (const player of state.players) {
    for (const card of player.field.banish) {
      if (card.id === id) {
        return card;
      }
    }
    for (const card of player.field.deck) {
      if (card.id === id) {
        return card;
      }
    }
    for (const card of player.field.extra) {
      if (card.id === id) {
        return card;
      }
    }
    for (const card of player.field.extraMonsterZone) {
      if (card?.id === id) {
        return card;
      }
    }
    if (player.field.fieldZone?.id === id) {
      return player.field.fieldZone;
    }
    for (const card of player.field.grave) {
      if (card.id === id) {
        return card;
      }
    }
    for (const card of player.field.hand) {
      if (card.id === id) {
        return card;
      }
    }
    for (const card of player.field.mainMonsterZone) {
      if (card?.id === id) {
        return card;
      }
    }
    for (const card of player.field.spellZone) {
      if (card?.id === id) {
        return card;
      }
    }
  }
  return null;
}

export function getCardInPos(
  state: EventfulGameState,
  { controller, location, sequence }: CardPos,
) {
  const { field } = state.players[controller];
  if (location === "fieldZone") {
    return field.fieldZone;
  }
  return field[location][sequence] ?? null;
}

function setCard<State extends Pick<GameState, "players">>(
  state: State,
  card: CardInfo | null,
  { controller, location, sequence }: CardPos,
): State {
  const newCard: CardInfo | null = card
    ? { ...card, pos: { ...card.pos, controller, location, sequence } }
    : null;

  return {
    ...state,
    players: R.map(state.players, (player, i) =>
      i !== controller
        ? player
        : {
            field: {
              ...player.field,
              [location]: isPileLocation(location)
                ? updatePile(player.field[location], newCard, sequence)
                : location === "fieldZone"
                  ? newCard
                  : updateSlots(player.field[location], newCard, sequence),
            },
          },
    ),
  };
}

function updateSlots<Slots extends (CardInfo | null)[]>(
  slots: Slots,
  card: CardInfo | null,
  index: number,
): Slots {
  return slots.map((c, i) => (i === index ? card : c)) as Slots;
}

function updatePile(pile: CardInfo[], card: CardInfo | null, index: number) {
  return recalculateSequence(
    0 <= index && index < pile.length
      ? replaceOrRemove(pile, card, index)
      : card
        ? index < 0
          ? [card, ...pile]
          : [...pile, card]
        : pile,
  );
}

function replaceOrRemove(
  arr: CardInfo[],
  value: CardInfo | null,
  index: number,
): CardInfo[] {
  return value
    ? arr.map((c, i) => (i === index ? value : c))
    : arr.filter((_, i) => i !== index);
}

function recalculateSequence(cards: CardInfo[]): CardInfo[] {
  return cards.map((c, i) => ({ ...c, pos: { ...c.pos, sequence: i } }));
}

export function isCardPosEqual(a: CardPos, b: CardPos) {
  return (
    a.controller === b.controller &&
    a.location === b.location &&
    a.sequence === b.sequence &&
    a.overlay === b.overlay
  );
}

// if (isPileLocation(location)) {
//   const store = state.players[controller].field[location];
//   if (sequence < 0) {
//     if (card) {
//       store.unshift(card);
//     }
//   } else if (sequence >= store.length) {
//     if (card) {
//       store.push(card);
//     }
//   } else if (card) {
//     store.splice(sequence, 1, cardWithPos(card, controller, location, 0));
//   } else {
//     store.splice(sequence, 1);
//   }
//   for (let i = 0; i < store.length; i++) {
//     store[i].pos.location = location;
//     store[i].pos.sequence = i;
//   }
// } else if (location === "fieldZone") {
//   state.players[controller].field[location] = cardWithPos(
//     card,
//     controller,
//     location,
//     0
//   );
// } else {
//   const store = state.players[controller].field[location];
//   store[sequence] = cardWithPos(card, controller, location, sequence);
// }
