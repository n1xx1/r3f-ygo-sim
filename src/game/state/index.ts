import { Tuple } from "@/lib/type-utils";
import { OcgMessage, OcgResponse } from "ocgcore-wasm";
import * as R from "remeda";
import { create } from "zustand";
import { combine } from "zustand/middleware";
import { ControllerSizes } from "../utils/position";
import { DuelEvent } from "./event";

export interface GameState {
  players: [PlayerState, PlayerState];
  chain: ChainState[];
  turn: number;
  turnPlayer: 0 | 1;
  phase: GameStatePhases;

  selectedCard: { pos?: CardPos; code?: number } | null;
  showPile: {
    controller: 0 | 1;
    location: "grave" | "extra" | "banish";
  } | null;
  selectField: { positions: CardFieldPos[]; count: number } | null;
  events: DuelEventEntry[];
  actions: CardAction[];
  dialog: DialogConfig | null;
  debug: {
    ocgMessages: OcgMessage[];
  };
}

export type EventGameState = Pick<
  GameState,
  "players" | "turn" | "turnPlayer" | "phase" | "chain"
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
  nextState: EventGameState;
}

export interface CardAction {
  kind:
    | "continue"
    | "activate"
    | "summon"
    | "specialSummon"
    | "setMonster"
    | "setSpell"
    | "changePos";
  card: CardInfo | null;
  response: OcgResponse;
}

export type CardActionBundle = CardAction["kind"] extends infer T
  ? T extends CardAction["kind"]
    ? { kind: `many_${T}`; actions: (CardAction & { type: T })[] }
    : never
  : never;

export interface CardInfo {
  id: string;
  code: number;
  pos: CardPos;
  position: CardPosition;
  materials: CardInfo[];
  overlaySize: number;
}

export type PartialCardInfo = Pick<CardInfo, "id"> &
  Partial<Omit<CardInfo, "id">>;

export type CardPosition = "up_atk" | "up_def" | "down_atk" | "down_def";

export function isFaceup(p: CardPosition): p is "up_atk" | "up_def" {
  return p === "up_atk" || p === "up_def";
}

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

interface DialogConfigBase {
  id: string;
  title: string;
  player: 0 | 1;
}

export interface DialogConfigYesNo extends DialogConfigBase {
  type: "yesno";
}

export interface DialogConfigEffectYesNo extends DialogConfigBase {
  type: "effectyn";
}

export interface DialogConfigCards extends DialogConfigBase {
  type: "cards";
  min: number;
  max: number;
  canCancel: boolean;
  cards: {
    code: number;
    controller: 0 | 1;
    location: CardLocation;
    position: CardPosition;
    sequence: number;
  }[];
}

export interface DialogConfigChain extends DialogConfigBase {
  type: "chain";
  forced: boolean;
  cards: {
    code: number;
    controller: 0 | 1;
    location: CardLocation;
    position: CardPosition;
    sequence: number;
  }[];
}

export interface DialogConfigActionMany extends DialogConfigBase {
  type: "actionMany";
  actions: CardAction[];
}

export interface DialogConfigPosition extends DialogConfigBase {
  type: "position";
  code: number;
  positions: CardPosition[];
}

export interface DialogConfigSelectUnselect extends DialogConfigBase {
  type: "selectUnselect";
  min: number;
  max: number;
  canCancel: boolean;
  canFinish: boolean;
  selects: {
    code: number;
    controller: 0 | 1;
    location: CardLocation;
    position: CardPosition;
    sequence: number;
    response: OcgResponse;
  }[];
  unselects: {
    code: number;
    controller: 0 | 1;
    location: CardLocation;
    position: CardPosition;
    sequence: number;
    response: OcgResponse;
  }[];
}

export interface DialogConfigSelectTribute extends DialogConfigBase {
  type: "tribute";
  // TODO
}

export interface DialogConfigSelectOption extends DialogConfigBase {
  type: "option";
  options: {
    name: string;
    response: OcgResponse;
  }[];
}

export type DialogConfig =
  | DialogConfigYesNo
  | DialogConfigEffectYesNo
  | DialogConfigCards
  | DialogConfigChain
  | DialogConfigActionMany
  | DialogConfigPosition
  | DialogConfigSelectUnselect
  | DialogConfigSelectTribute
  | DialogConfigSelectOption;

export interface PlayerState {
  lp: number;
  field: {
    deck: CardInfo[];
    hand: CardInfo[];
    grave: CardInfo[];
    extra: CardInfo[];
    banish: CardInfo[];
    extraMonsterZone: Tuple<CardInfo | null, 2>;
    mainMonsterZone: Tuple<CardInfo | null, 5>;
    spellZone: Tuple<CardInfo | null, 5>;
    fieldZone: CardInfo | null;
  };
}

export interface ChainState {
  link: number;
  card: CardInfo;
  trigger: CardPos;
}

function createInitialPlayerState(): PlayerState {
  return {
    lp: 0,
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
      chain: [],
      turn: 0,
      turnPlayer: 0,
      phase: "dp",

      showPile: null,
      selectedCard: null,
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
      queueEvent(event: Omit<DuelEventEntry, "id">, replaceLast?: boolean) {
        set(({ events }) => ({
          events: [
            ...events.slice(0, replaceLast ? -1 : undefined),
            { ...event, id: crypto.randomUUID() },
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
            state.events.at(0)?.nextState ?? ({} as Partial<EventGameState>),
            ["players", "turn", "turnPlayer", "phase", "chain"],
          ),
          events: state.events.slice(1),
        }));
      },
      setActions(actions: CardAction[]) {
        set(() => ({ actions }));
      },
      setSelectedCard(card: { pos?: CardPos; code?: number } | null) {
        set(() => ({ selectedCard: card }));
      },
      setShowPile(controller: 0 | 1, location: "grave" | "extra" | "banish") {
        set(() => ({ showPile: { controller, location } }));
      },
      closeShowPile() {
        set(() => ({ showPile: null }));
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

export function useGameEventOfType<T extends DuelEvent["type"]>(
  type: T,
  cond?: (event: DuelEvent & { type: T }) => boolean,
) {
  return useGameStore((s) => {
    const currentEvent = s.events.at(0);
    if (currentEvent?.event.type === type) {
      const e = currentEvent as Omit<DuelEventEntry, "event"> & {
        event: DuelEvent & { type: T };
      };
      if (!cond || cond?.(e.event)) {
        return e;
      }
    }
    return null;
  });
}

export function extractEventGS({
  players,
  turn,
  turnPlayer,
  phase,
  chain,
}: GameState): EventGameState {
  return { players, turn, turnPlayer, phase, chain };
}

export function cardPos(
  controller: 0 | 1,
  location: CardLocation,
  sequence: number,
  overlay: number | null = null,
): CardPos {
  return { controller, location, sequence, overlay };
}

export function appendChain<State extends Pick<GameState, "chain">>(
  state: State,
  chained: ChainState,
): State {
  return {
    ...state,
    chain: [...state.chain, chained],
  };
}

export function popChain<State extends Pick<GameState, "chain">>(
  state: State,
): State {
  return {
    ...state,
    chain: state.chain.slice(0, state.chain.length - 1),
  };
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
  codes: number[],
): State {
  return {
    ...state,
    players: R.map(state.players, (player, i) =>
      i !== controller
        ? player
        : {
            ...player,
            field: {
              ...player.field,
              hand: recalculateSequence(reorderPile(player.field.hand, codes)),
            },
          },
    ),
  };
}

function reorderPile(pile: CardInfo[], codes: number[]) {
  pile = Array.from(pile);
  return codes.flatMap((code) => {
    const index = pile.findIndex((c) => c.code === code);
    return pile.splice(index, 1);
  });
}

function updateCards(state: EventGameState, cards: PartialCardInfo[]) {
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
      ...player,
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

const directInteractionLocations = [
  "hand",
  "spellZone",
  "fieldZone",
  "extraMonsterZone",
  "mainMonsterZone",
] as const;

export function isDirectInteractionLocation(
  location: CardLocation,
): location is (typeof directInteractionLocations)[number] {
  return (directInteractionLocations as readonly CardLocation[]).includes(
    location,
  );
}

const pileLocations = ["hand", "deck", "grave", "extra", "banish"] as const;

export function isPileLocation(
  location: CardLocation,
): location is (typeof pileLocations)[number] {
  return (pileLocations as readonly CardLocation[]).includes(location);
}

export function isPileTop(
  location: CardLocation,
  sequence: number,
  sizes: ControllerSizes,
): location is "deck" | "grave" | "banish" | "extra" {
  switch (location) {
    case "deck":
      return sequence === 0;
    case "grave":
      return sequence === sizes.grave - 1;
    case "banish":
      return sequence === sizes.banish - 1;
    case "extra":
      if (sizes.extraUp === 0) {
        return sequence === 0;
      }
      return sequence === sizes.extra - 1;
    default:
      return false;
  }
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

const fieldNotPileLocations = [
  "spellZone",
  "fieldZone",
  "extraMonsterZone",
  "mainMonsterZone",
] as const;

export function isFieldNotPileLocation(
  location: CardLocation,
): location is (typeof fieldNotPileLocations)[number] {
  return (fieldNotPileLocations as readonly CardLocation[]).includes(location);
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
  state: Pick<EventGameState, "players">,
  { controller, location, sequence, overlay }: CardPos,
) {
  const card = getCardInPosImpl(state, { controller, location, sequence });
  if (overlay !== null) {
    return card?.materials.at(overlay) ?? null;
  }
  return card;
}

function getCardInPosImpl(
  state: Pick<EventGameState, "players">,
  { controller, location, sequence }: Omit<CardPos, "overlay">,
) {
  const { field } = state.players[controller];
  if (location === "fieldZone") {
    return field.fieldZone;
  }
  return field[location][sequence] ?? null;
}

export function setCard<State extends Pick<GameState, "players">>(
  state: State,
  card: CardInfo | null,
  { controller, location, sequence, overlay }: CardPos,
): State {
  if (overlay !== null) {
    const target = getCardInPosImpl(state, { controller, location, sequence });
    if (!target) {
      console.warn("failed to set card");
      return state;
    }

    const newCard = card
      ? { ...card, pos: { controller, location, sequence, overlay } }
      : null;

    const materials = updatePile(target.materials, newCard, overlay, true);

    return setCardImpl(
      state,
      { ...target, materials },
      { controller, location, sequence },
    );
  } else {
    return setCardImpl(state, card, { controller, location, sequence });
  }
}

export function setCardImpl<State extends Pick<GameState, "players">>(
  state: State,
  card: CardInfo | null,
  { controller, location, sequence }: Omit<CardPos, "overlay">,
): State {
  const newCard: CardInfo | null = card
    ? {
        ...card,
        pos: { controller, location, sequence, overlay: null },
        materials: card.materials.map((c) => ({
          ...c,
          pos: { ...c.pos, controller, location, sequence },
          overlaySize: card.materials.length,
        })),
      }
    : null;

  return {
    ...state,
    players: R.map(
      state.players,
      (player, i): PlayerState =>
        i !== controller
          ? player
          : {
              ...player,
              field: {
                ...player.field,
                [location]: isPileLocation(location)
                  ? updatePile(player.field[location], newCard, sequence)
                  : location === "fieldZone"
                    ? newCard
                    : R.map(player.field[location], (c, i) =>
                        i === sequence ? newCard : c,
                      ),
              },
            },
    ),
  };
}

function updatePile(
  pile: CardInfo[],
  card: CardInfo | null,
  index: number,
  isOverlay?: boolean,
) {
  return recalculateSequence(
    0 <= index && index < pile.length
      ? replaceOrRemove(pile, card, index)
      : card
        ? index < 0
          ? [card, ...pile]
          : [...pile, card]
        : pile,
    isOverlay,
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

function recalculateSequence(
  cards: CardInfo[],
  isOverlay?: boolean,
): CardInfo[] {
  return cards.map((c, i) => ({
    ...c,
    overlaySize: isOverlay ? cards.length : c.overlaySize,
    pos: { ...c.pos, [isOverlay ? "overlay" : "sequence"]: i },
  }));
}

export function isCardPosEqual(a: CardPos, b: CardPos) {
  return (
    a.controller === b.controller &&
    a.location === b.location &&
    a.sequence === b.sequence &&
    a.overlay === b.overlay
  );
}
