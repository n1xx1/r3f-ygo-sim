"use client";

import { animated, easings, to, useSpring } from "@react-spring/three";
import {
  Html,
  PerspectiveCamera,
  useGLTF,
  useProgress,
  useTexture,
} from "@react-three/drei";
import { Canvas, extend, ThreeElements, ThreeEvent } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { animate, AnimatePresence, motion } from "framer-motion";
import { OcgPosition, OcgResponseType } from "ocgcore-wasm";
import {
  ComponentProps,
  ComponentPropsWithRef,
  memo,
  Ref,
  RefObject,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { twc } from "react-twc";
import * as R from "remeda";
import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
} from "three";
import { useEventCallback } from "usehooks-ts";
import { useShallow } from "zustand/react/shallow";
import { cn } from "../lib/cn";
import { CardAnimationRef, CardAnimations } from "./animations";
import {
  egs,
  gameInstancePromise,
  gs,
  loadedData,
  runSimulatorStep,
  sendResponse,
} from "./runner";
import { GameSelectField } from "./select-field";
import {
  CardAction,
  CardActionBundle,
  CardInfo,
  CardPos,
  CardPosition,
  DialogConfigActionMany,
  DialogConfigCards,
  DialogConfigChain,
  DialogConfigEffectYesNo,
  DialogConfigPosition,
  DialogConfigSelectOption,
  DialogConfigSelectUnselect,
  DialogConfigYesNo,
  getCardInPos,
  isCardPosEqual,
  isDirectInteractionLocation,
  isPileLocation,
  isPileTop,
  useGameStore,
} from "./state";
import {
  textureCardBack,
  textureCardFront,
  textureChain,
  textureHighlight,
  textureSlot,
} from "./textures";
import { DebugMenu } from "./ui/debug";
import { SelectableCard } from "./ui/selectable-card";
import {
  degToRad,
  fieldRotation,
  getCardPositionObj,
  useComputeCardPosition,
  useControllerSizes,
  useHandOffset,
} from "./utils/position";

const load = gameInstancePromise;

extend({
  Group,
  PointLight,
  DirectionalLight,
  HemisphereLight,
  MeshStandardMaterial,
  PlaneGeometry,
  Object3D,
  Mesh,
});

export function Game() {
  const wrapperRef = useRef<HTMLDivElement>(null);

  const cardMotionValuesRef = useRef<Map<string, CardAnimationRef>>(null!);
  cardMotionValuesRef.current ??= new Map();

  useEffect(() => {
    const unsub = useGameStore.subscribe((state, prevState) => {
      const idle = state.events.length === 0;
      const prevIdle = prevState.events.length === 0;
      if (idle !== prevIdle) {
        gs().setSelectedCard(null);
      }
    });

    return () => {
      unsub();
    };
  }, []);

  const onRightClick = useRightClickCancel();

  return (
    <>
      <GameInitializer />
      <CardAnimations cardMotionValuesRef={cardMotionValuesRef} />
      <GameWrapper
        ref={wrapperRef}
        onContextMenu={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onRightClick();
        }}
      >
        <RenderDialog />
        <HtmlTurnState />
        <OverlaySelectedCard />
        <Canvas shadows dpr={[1, 2]}>
          <Suspense>
            <PerspectiveCamera makeDefault fov={70} position={[0, -2, 16]} />
            <group position={[0, 1, -0.268]}>
              <Model
                position={[4, 0, 3.626]}
                scale={[20, 20, 20]}
                rotation={[(90 - fieldRotation) * degToRad, 0, 0.005]}
              />
            </group>
            <group
              onClick={() => {
                gs().setSelectedCard(null);
              }}
              onPointerMissed={(e) => {
                gs().setSelectedCard(null);
                e.preventDefault();
                if (e.button === 2) {
                  onRightClick();
                }
              }}
              onContextMenu={(e) => {
                e.stopPropagation();
                e.nativeEvent.preventDefault();
                onRightClick();
              }}
            >
              <hemisphereLight
                // castShadow
                intensity={4}
                color="#fff"
                groundColor="#777"
              />
              <GameCards
                wrapperRef={wrapperRef}
                cardMotionValuesRef={cardMotionValuesRef}
              />
              <ChainLinkIndicators />
              <GameSelectField />
            </group>
            <Effects />
          </Suspense>
        </Canvas>
      </GameWrapper>
      <DebugMenu />
    </>
  );
}

interface OverlaySelectedCardProps {}

function OverlaySelectedCard({}: OverlaySelectedCardProps) {
  const selectedCard = useGameStore((s) =>
    s.selectedCard ? getCardInPos(s, s.selectedCard) : null,
  );

  const cardInfo = useMemo(() => {
    if (!selectedCard || selectedCard.code <= 0) {
      return null;
    }
    return loadedData.cards.get(selectedCard.code) ?? null;
  }, [selectedCard]);

  return (
    cardInfo && (
      <div className="absolute top-[2cqw] h-[40cqw] left-[2cqw] w-[20cqw] z-20 bg-gray-800 text-white p-[1cqw] text-[1cqw] flex flex-col gap-[1cqw]">
        <div className="overflow-hidden text-nowrap text-ellipsis flex-none">
          {cardInfo.name}
        </div>
        <div className="flex gap-[1cqw] flex-none">
          <img className="h-[13cqw]" src={textureCardFront(cardInfo.id)} />
          <div className="flex flex-col gap-[0.1cqw]">
            <div>Level {cardInfo.data.level}</div>
            <div>ATK {cardInfo.data.attack}</div>
            <div>DEF {cardInfo.data.defense}</div>
          </div>
        </div>
        <div className="text-[0.8cqw] whitespace-pre-wrap overflow-y-auto flex-1">
          {cardInfo.desc}
        </div>
      </div>
    )
  );
}

interface GameCardsProps {
  wrapperRef: Ref<HTMLDivElement>;
  cardMotionValuesRef: RefObject<Map<string, CardAnimationRef>>;
}

function GameCards({ wrapperRef, cardMotionValuesRef }: GameCardsProps) {
  const allCards = useAllCards();

  return (
    <>
      {allCards.map((card) => (
        <RenderCard
          key={card.id}
          wrapperRef={wrapperRef}
          card={card}
          cardMotionValuesRef={cardMotionValuesRef}
        />
      ))}
    </>
  );
}

function ChainLinkIndicators() {
  const chains = useGameStore((s) => s.chain);
  const currentEvent = useGameStore(
    useShallow((s) => {
      const event = s.events.at(0);
      if (
        event?.event.type === "chain" ||
        event?.event.type === "chainSolved"
      ) {
        return { ...event, event: event.event };
      }
      return null;
    }),
  );

  useEffect(() => {
    if (!currentEvent) {
      return;
    }
    const timeout = setTimeout(() => {
      gs().nextEvent();
    }, 200);
    return () => clearTimeout(timeout);
  }, [currentEvent?.id]);

  return (
    <>
      {currentEvent && currentEvent.event.type === "chain" && (
        <ChainLinkIndicator
          key={currentEvent.event.link}
          link={currentEvent.event.link}
          trigger={currentEvent.event.trigger}
        />
      )}
      {chains.map((chain) => (
        <ChainLinkIndicator
          key={chain.link}
          link={chain.link}
          trigger={chain.trigger}
        />
      ))}
    </>
  );
}

interface ChainLinkIndicatorProps {
  link: number;
  trigger: CardPos;
}

function ChainLinkIndicator({ trigger }: ChainLinkIndicatorProps) {
  const sizes = useControllerSizes(trigger.controller);

  const position = useMemo(() => {
    return getCardPositionObj(
      {
        code: 0,
        id: "",
        pos: {
          controller: trigger.controller,
          location: trigger.location,
          sequence: trigger.sequence,
          overlay: null,
        },
        position: "up_atk",
      },
      sizes,
    );
  }, [trigger.controller, trigger.location, trigger.sequence, sizes]);

  const springs = useSpring({
    from: { rotation: 0 },
    to: { rotation: -360 * degToRad },
    loop: true,
    config: { duration: 5000, easing: easings.linear },
  });

  return (
    <object3D
      position-x={position.px}
      position-y={position.py}
      position-z={position.pz + 0.001}
      rotation-x={position.rx}
      rotation-y={position.ry}
      rotation-z={position.rz}
    >
      <AnimatedMesh rotation-y={0} rotation-z={springs.rotation}>
        <Suspense
          fallback={
            <meshStandardMaterial
              color={Color.NAMES.grey}
              opacity={0.2}
              transparent
              metalness={0}
              roughness={0.5}
            />
          }
        >
          <ChainLinkIndicatorMaterial />
        </Suspense>
        <planeGeometry args={[cardScale * 0.5, cardScale * 0.5, 1]} />
      </AnimatedMesh>
    </object3D>
  );
}

const AnimatedMesh = animated("mesh");

function ChainLinkIndicatorMaterial() {
  const texture = useTexture(textureChain);
  return (
    <meshStandardMaterial
      map={texture}
      transparent
      metalness={0}
      roughness={0.5}
      emissive={0xffffff}
      emissiveIntensity={1}
      toneMapped={false}
    />
  );
}

function useRightClickCancel() {
  return useCallback(() => {
    const idle = gs().events.length === 0;

    if (!idle) {
      return;
    }

    const dialog = gs().dialog;
    if (dialog) {
      switch (dialog.type) {
        case "yesno":
          sendResponse({ type: OcgResponseType.SELECT_YESNO, yes: false });
          runSimulatorStep();
          break;
        case "effectyn":
          sendResponse({ type: OcgResponseType.SELECT_EFFECTYN, yes: false });
          runSimulatorStep();
          break;
        case "cards":
          if (dialog.canCancel || dialog.min === 0) {
            sendResponse({
              type: OcgResponseType.SELECT_CARD,
              indicies: dialog.canCancel ? null : [],
            });
            runSimulatorStep();
          }
          break;
        case "chain":
          if (!dialog.forced) {
            sendResponse({
              type: OcgResponseType.SELECT_CHAIN,
              index: null,
            });
            runSimulatorStep();
          }
          break;
        case "actionMany":
          gs().closeDialog();
          break;
      }
    }
  }, []);
}

export function Model(props: ThreeElements["group"]) {
  const { nodes, materials } = useGLTF("/models/table/scene.gltf");
  return (
    <group {...props} dispose={null}>
      <group
        position={[-0.192, -0.984, 0]}
        rotation={[Math.PI / 2, -0.005, -Math.PI]}
        scale={0.01}
      >
        <group rotation={[-Math.PI, 0, 0]}>
          <mesh
            castShadow
            receiveShadow
            geometry={(nodes["Desk_LP_01_-_Default_0"] as any).geometry}
            material={materials["01_-_Default"]}
            position={[-79.353, 0, 51.852]}
            rotation={[-Math.PI / 2, Math.PI / 2, 0]}
          />
        </group>
      </group>
    </group>
  );
}

useGLTF.preload("/models/table/scene.gltf");

function GameInitializer({}: {}) {
  use(load);

  const [initPhase, setInitPhase] = useState<0 | 1 | 2>(0);
  const isLoading = useProgress((p) => p.active);

  useEffect(() => {
    if (initPhase === 0 && !isLoading) {
      useTexture.preload([
        textureSlot,
        textureCardBack,
        textureHighlight,
        ...Array.from(loadedData.cards.values(), (c) =>
          textureCardFront(c.data.code),
        ),
      ]);
      setInitPhase(1);
    }
    if (initPhase === 1 && !isLoading) {
      setInitPhase(2);
      useGameStore
        .getState()
        .queueEvent({ event: { type: "start" }, nextState: egs() });
      runSimulatorStep();
    }
  }, [isLoading, initPhase]);

  return null;
}

function HtmlTurnState({}: {}) {
  const event = useGameStore((s) => s.events.at(0));
  const currentEventRef = useRef<null | string>(null);
  currentEventRef.current = event?.id ?? null;

  const [animationPhase, setAnimationPhase] = useState(0);

  return (
    <AnimatePresence mode="wait">
      {event &&
        (event.event.type === "start" || event.event.type === "phase") &&
        animationPhase === 0 && (
          <motion.div
            key={event.id}
            className="absolute z-10 inset-0 flex items-center justify-center"
          >
            <motion.div
              className="relative text-[10cqh] text-white font-bold"
              initial="initial"
              animate="enter"
              exit="exit"
              variants={{
                initial: { x: "20cqw", opacity: 0 },
                enter: { x: "0", opacity: 1 },
                exit: { x: "20cqw", opacity: 0 },
              }}
              transition={{ duration: 0.2 }}
              onAnimationComplete={(def) => {
                if (def === "enter") {
                  setTimeout(() => setAnimationPhase(1), 200);
                }
                if (def === "exit") {
                  useGameStore.getState().nextEvent();
                  setAnimationPhase(0);
                }
              }}
            >
              {event.event.type === "start"
                ? "DUEL START!"
                : event.nextState.phase}
            </motion.div>
          </motion.div>
        )}
    </AnimatePresence>
  );
}

function Effects() {
  return (
    <EffectComposer>
      {/* <N8AO intensity={1} distanceFalloff={1} /> */}
      {/* <SMAA /> */}
      <Bloom />
      <Vignette />
    </EffectComposer>
  );
}

function RenderDialog() {
  const idle = useGameStore((s) => s.events.length === 0);
  const dialog = useGameStore((s) => s.dialog);

  return (
    <AnimatePresence>
      {idle && dialog && (
        <motion.div
          key={dialog.id}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="bg-gray-500 p-[1cqw] text-[1.5cqw] rounded-[1cqw]">
            <div className="text-center text-xs">
              (for player P{dialog.player + 1})
            </div>
            <div className="text-center">{dialog.title}</div>
            {(dialog.type === "yesno" || dialog.type === "effectyn") && (
              <DialogSelectYesNo dialog={dialog} />
            )}
            {dialog.type === "selectUnselect" && (
              <DialogSelectUnselect dialog={dialog} />
            )}
            {dialog.type === "cards" && <DialogSelectCard dialog={dialog} />}
            {dialog.type === "chain" && <DialogSelectChain dialog={dialog} />}
            {dialog.type === "position" && (
              <DialogSelectPosition dialog={dialog} />
            )}
            {dialog.type === "actionMany" && (
              <DialogSelectActionMany dialog={dialog} />
            )}
            {dialog.type === "option" && <DialogSelectOption dialog={dialog} />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type DialogSelectPositionProps = {
  dialog: DialogConfigPosition;
};

function DialogSelectPosition({
  dialog: { positions, code },
}: DialogSelectPositionProps) {
  const [selected, setSelected] = useState<null | CardPosition>(null);
  return (
    <>
      <div className="max-w-[30cqw] overflow-x-auto">
        <div className="flex items-center justify-center gap-[1cqw] py-[1cqw]">
          {positions.map((pos, i) => {
            const faceup = pos === "up_atk" || pos === "up_def";
            const def = pos === "down_def" || pos === "up_def";
            return (
              <div
                key={i}
                className="flex-none bg-gray-600 relative h-[9cqw] w-[9cqw] flex items-center justify-center"
                onClick={() => setSelected(selected === pos ? null : pos)}
              >
                <img
                  className={cn(
                    "h-[8cqw] opacity-75",
                    selected === pos && "opacity-100",
                    def && "-rotate-90",
                  )}
                  src={faceup ? textureCardFront(code) : textureCardBack}
                  alt=""
                />
                {selected === pos && (
                  <div className="absolute -top-3 -left-2 w-4 h-4">✅</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-center gap-[2cqw] mt-[1cqw]">
        <Button
          onClick={() => {
            if (selected === null) {
              return;
            }
            sendResponse({
              type: OcgResponseType.SELECT_POSITION,
              position: {
                up_atk: OcgPosition.FACEUP_ATTACK,
                up_def: OcgPosition.FACEUP_DEFENSE,
                down_atk: OcgPosition.FACEDOWN_ATTACK,
                down_def: OcgPosition.FACEDOWN_DEFENSE,
              }[selected],
            });
            runSimulatorStep();
          }}
          aria-disabled={selected === null}
        >
          Confirm
        </Button>
      </div>
    </>
  );
}

type DialogSelectUnselectProps = {
  dialog: DialogConfigSelectUnselect;
};

function DialogSelectUnselect({
  dialog: { selects, unselects, canCancel, canFinish },
}: DialogSelectUnselectProps) {
  return (
    <>
      <div className="w-[30cqw] flex overflow-x-auto justify-center">
        <div className="flex items-center justify-start gap-[1cqw] py-[1cqw]">
          {unselects.map((c, i) => (
            <SelectableCard
              key={i}
              code={c.code}
              selected={true}
              onSelect={() => {}}
              onUnselect={() => {
                sendResponse(c.response);
                runSimulatorStep();
              }}
            />
          ))}
          {selects.map((c, i) => (
            <SelectableCard
              key={i}
              code={c.code}
              selected={false}
              onSelect={() => {
                sendResponse(c.response);
                runSimulatorStep();
              }}
              onUnselect={() => {}}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center gap-[2cqw] mt-[1cqw]">
        {(canCancel || canFinish) && (
          <Button
            onClick={() => {
              sendResponse({
                type: OcgResponseType.SELECT_UNSELECT_CARD,
                index: null,
              });
              runSimulatorStep();
            }}
          >
            {unselects.length > 0 ? "Finish" : "Cancel"}
          </Button>
        )}
      </div>
    </>
  );
}

type DialogSelectChainProps = {
  dialog: DialogConfigChain;
};

function DialogSelectChain({
  dialog: { cards, forced },
}: DialogSelectChainProps) {
  const [selected, setSelected] = useState<null | number>(null);
  return (
    <>
      {cards.length === 0 ? (
        <div className="text-gray-800">No effect applicable.</div>
      ) : (
        <div className="w-[30cqw] flex overflow-x-auto justify-center">
          <div className="flex items-center justify-start gap-[1cqw] py-[1cqw]">
            {cards.map((c, i) => (
              <SelectableCard
                key={i}
                code={c.code}
                selected={selected === i}
                onSelect={() => setSelected(i)}
                onUnselect={() => setSelected(null)}
              />
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-center gap-[2cqw] mt-[1cqw]">
        {!forced && (
          <Button
            onClick={() => {
              sendResponse({
                type: OcgResponseType.SELECT_CHAIN,
                index: null,
              });
              runSimulatorStep();
            }}
          >
            {cards.length === 0 ? "Continue" : "Cancel"}
          </Button>
        )}
        {cards.length > 0 && (
          <Button
            onClick={() => {
              if (selected === null) {
                return;
              }
              sendResponse({
                type: OcgResponseType.SELECT_CHAIN,
                index: selected,
              });
              runSimulatorStep();
            }}
            aria-disabled={selected === null}
          >
            Select
          </Button>
        )}
      </div>
    </>
  );
}

type DialogSelectActionManyProps = {
  dialog: DialogConfigActionMany;
};

function DialogSelectActionMany({
  dialog: { actions },
}: DialogSelectActionManyProps) {
  const [selected, setSelected] = useState<null | number>(null);

  return (
    <>
      <div className="w-[30cqw] flex overflow-x-auto justify-center">
        <div className="flex items-center justify-start gap-[1cqw] py-[1cqw]">
          {actions.map((c, i) => (
            <SelectableCard
              key={i}
              code={c.card!.code}
              selected={selected === i}
              onSelect={() => setSelected(i)}
              onUnselect={() => setSelected(null)}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center gap-[2cqw] mt-[1cqw]">
        <Button
          onClick={() => {
            gs().closeDialog();
            gs().setSelectedCard(null);
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={() => {
            if (selected === null) {
              return;
            }
            sendResponse(actions[selected].response);
            runSimulatorStep();
          }}
          aria-disabled={selected === null}
        >
          Select
        </Button>
      </div>
    </>
  );
}

type DialogSelectOptionProps = {
  dialog: DialogConfigSelectOption;
};

function DialogSelectOption({ dialog: { options } }: DialogSelectOptionProps) {
  return (
    <div className="w-[30cqw] flex flex-col overflow-x-auto items-center gap-[0.5cqw]">
      {options.map((o, i) => (
        <Button
          className="text-[1cqw] py-[0.2cqw]"
          key={i}
          onClick={() => {
            sendResponse(o.response);
            runSimulatorStep();
          }}
        >
          {o.name}
        </Button>
      ))}
    </div>
  );
}

type DialogSelectCardProps = {
  dialog: DialogConfigCards;
};

function DialogSelectCard({
  dialog: { min, max, cards, canCancel },
}: DialogSelectCardProps) {
  const [selected, setSelected] = useState(() => new Set<number>());

  const canContinue = min <= selected.size && selected.size <= max;

  return (
    <>
      <div className="w-[30cqw] flex overflow-x-auto justify-center">
        <div className="flex items-center justify-start gap-[1cqw] py-[1cqw]">
          {cards.map((c, i) => (
            <SelectableCard
              key={i}
              code={c.code}
              selected={selected.has(i)}
              onSelect={() => {
                if (min === 1 && min === max) {
                  setSelected(new Set([i]));
                } else if (max < selected.size) {
                  setSelected((s) => new Set(s).add(i));
                }
              }}
              onUnselect={() => {
                setSelected((s) => {
                  const s1 = new Set(s);
                  s1.delete(i);
                  return s1;
                });
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center gap-[2cqw] mt-[1cqw]">
        <Button
          onClick={() => {
            sendResponse({
              type: OcgResponseType.SELECT_CARD,
              indicies: [...selected.values()],
            });
            runSimulatorStep();
          }}
          aria-disabled={!canContinue}
        >
          Continue
        </Button>
        {(canCancel || min === 0) && (
          <Button
            onClick={() => {
              sendResponse({
                type: OcgResponseType.SELECT_CARD,
                indicies: canCancel ? null : [],
              });
              runSimulatorStep();
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </>
  );
}

const Button = twc.button`py-[0.5cqw] px-[1cqw] rounded-[1cqw] bg-gray-800 text-white hover:bg-gray-700 aria-disabled:bg-gray-600 aria-disabled:pointer-events-none`;

type DialogSelectYesNoProps = {
  dialog: DialogConfigYesNo | DialogConfigEffectYesNo;
};

function DialogSelectYesNo({ dialog: { type } }: DialogSelectYesNoProps) {
  const handleClick = useCallback((yes: boolean) => {
    sendResponse({
      type:
        type === "yesno"
          ? OcgResponseType.SELECT_YESNO
          : OcgResponseType.SELECT_EFFECTYN,
      yes,
    });
    runSimulatorStep();
  }, []);

  return (
    <div className="flex items-center justify-center gap-[2cqw] mt-[1cqw]">
      <Button onClick={() => handleClick(true)}>Yes</Button>
      <Button onClick={() => handleClick(false)}>No</Button>
    </div>
  );
}

interface RenderCardProps {
  card: CardInfo;
  wrapperRef: Ref<HTMLDivElement>;
  cardMotionValuesRef: RefObject<Map<string, CardAnimationRef>>;
}

function RenderCard({
  card,
  wrapperRef,
  cardMotionValuesRef,
}: RenderCardProps) {
  let {
    pos: { location, sequence },
  } = card;

  const setSelectedCard = useGameStore((s) => s.setSelectedCard);
  const sizes = useControllerSizes(card.pos.controller);

  const { springs: hsprings, hover, updateHover } = useHandOffset(card);

  const ref = useComputeCardPosition(card);
  cardMotionValuesRef.current.set(card.id, ref);

  const px = to([ref.g.springs.px], (px) => px);
  const py = to(
    [ref.g.springs.py, ref.o.springs.py, hsprings.hy],
    (py, opy, hy) => py + opy + hy,
  );
  const pz = to([ref.g.springs.pz, hsprings.hz], (pz, hz) => pz + hz);
  const rx = to([ref.g.springs.rx], (rx) => rx);
  const ry = to([ref.g.springs.ry], (ry) => ry);
  const rz = to([ref.g.springs.rz], (rz) => rz);
  const scale = to([hsprings.hs], (hs) => hs);

  const onPointerOver = useEventCallback((e: ThreeEvent<PointerEvent>) => {
    updateHover(true);
    e.stopPropagation();
  });

  const onPointerOut = useEventCallback(() => {
    updateHover(false);
  });

  const onClick = useEventCallback((e: ThreeEvent<MouseEvent>) => {
    setSelectedCard(card.pos);
    e.stopPropagation();
  });

  const isTop = isPileTop(location, sequence, sizes);
  const isInteractive = isDirectInteractionLocation(location) || isTop;

  return (
    <AnimatedObject3D
      position-x={px}
      position-y={py}
      position-z={pz}
      rotation-x={rx}
      rotation-y={ry}
      rotation-z={rz}
      scale-x={scale}
      scale-y={scale}
    >
      <RenderCardFront
        code={card.code}
        hover={hover}
        onPointerOver={isInteractive ? onPointerOver : undefined}
        onPointerOut={isInteractive ? onPointerOut : undefined}
        onClick={isInteractive ? onClick : undefined}
      />
      <RenderCardBack
        hover={hover}
        onPointerOver={isInteractive ? onPointerOver : undefined}
        onPointerOut={isInteractive ? onPointerOut : undefined}
        onClick={isInteractive ? onClick : undefined}
      />
      {isInteractive && (
        <RenderCardActions card={card} wrapperRef={wrapperRef} />
      )}
    </AnimatedObject3D>
  );
}

const AnimatedObject3D = animated("object3D");

interface RenderCardActionsProps {
  card: CardInfo;
  wrapperRef: Ref<HTMLDivElement>;
}

function RenderCardActions({ card, wrapperRef }: RenderCardActionsProps) {
  let {
    pos: { location, controller, sequence },
  } = card;

  const actions = useGameStore((s) => s.actions);
  const selectedCard = useGameStore((s) => s.selectedCard);
  const idle = useGameStore((s) => s.events.length === 0);
  const sizes = useControllerSizes(card.pos.controller);

  const selected =
    idle && selectedCard && isCardPosEqual(card.pos, selectedCard);

  const matchingActions = useMemo(() => {
    if (location === "hand" || !isPileLocation(location)) {
      return actions.filter(
        ({ card }) =>
          card?.pos.controller === controller &&
          card?.pos.location === location &&
          card?.pos.sequence === sequence,
      );
    }

    // for piles
    if (isPileTop(location, sequence, sizes)) {
      return R.pipe(
        actions,
        R.filter(
          ({ card }) =>
            card?.pos.controller === controller &&
            card?.pos.location === location,
        ),
        R.groupBy(({ kind }) => kind),
        R.values(),
        R.map(
          (actions): CardActionBundle => ({
            kind: `many_${actions[0].kind}` as const,
            actions: actions as any,
          }),
        ),
      );
    }
    return [];
  }, [actions, location, controller, sequence, sizes]);

  return (
    <>
      {selected && matchingActions.length > 0 && (
        <Html
          position={[0, cardScale / 2, 0]}
          portal={wrapperRef as any}
          center
        >
          <div className="select-none -translate-y-1/2 pb-[0.5cqw] text-[1.5cqw]">
            <div className="bg-black text-white rounded-md overflow-hidden">
              {matchingActions.map((c, i) => (
                <div
                  className="px-[1cqw] hover:bg-gray-700 cursor-pointer"
                  key={i}
                  onClick={() => {
                    if ("actions" in c) {
                      gs().setSelectedCard(null);
                      gs().openDialog({
                        id: crypto.randomUUID(),
                        player: gs().turnPlayer,
                        title: `Select action ${c.actions[0].kind}`,
                        type: "actionMany",
                        actions: c.actions,
                      });
                    } else if ("response" in c && c.response) {
                      sendResponse(c.response);
                      runSimulatorStep();
                    }
                  }}
                >
                  {c.kind}
                </div>
              ))}
            </div>
          </div>
        </Html>
      )}
      <Suspense>
        <RenderCardOverlay actions={matchingActions} />
      </Suspense>
    </>
  );
}

const cardScale = 2.5;
const cardRatio = 271 / 395;

interface RenderCardFrontProps extends ComponentProps<"mesh"> {
  hover?: boolean;
  code: number;
}

const RenderCardFront = memo(
  ({ hover, code, ...props }: RenderCardFrontProps) => {
    return (
      <mesh {...props}>
        {code > 0 ? (
          <Suspense
            fallback={
              <meshStandardMaterial
                color={Color.NAMES.grey}
                metalness={0}
                roughness={0.5}
              />
            }
          >
            <CardTextureMaterial hover={hover} code={code} />
          </Suspense>
        ) : (
          <meshStandardMaterial
            color={Color.NAMES.grey}
            metalness={0}
            roughness={0.5}
          />
        )}
        <planeGeometry args={[cardScale * cardRatio, cardScale, 1]} />
      </mesh>
    );
  },
);

RenderCardFront.displayName = "RenderCardFront";

type CardTextureMaterialProps = {
  hover?: boolean;
  code: number;
};

const CardTextureMaterial = memo(
  ({ hover, code }: CardTextureMaterialProps) => {
    const frontTexture = useTexture(textureCardFront(code));

    const springs = useSpring({
      emissiveIntensity: hover ? 0.03 : 0,
    });

    return (
      <AnimatedMeshStandardMaterial
        map={frontTexture}
        metalness={0}
        roughness={0.5}
        emissive={0xffffff}
        emissiveIntensity={springs.emissiveIntensity}
      />
    );
  },
);

const AnimatedMeshStandardMaterial = animated("meshStandardMaterial");

CardTextureMaterial.displayName = "CardTextureMaterial";

interface RenderCardBackProps extends ComponentProps<"mesh"> {
  hover?: boolean;
}

const RenderCardBack = memo(({ hover, ...props }: RenderCardBackProps) => {
  return (
    <mesh rotation={[0, 180 * degToRad, 0]} {...props}>
      <Suspense
        fallback={
          <meshStandardMaterial
            color={Color.NAMES.brown}
            metalness={0}
            roughness={0.5}
          />
        }
      >
        <CardBackMaterial hover={hover} />
      </Suspense>
      <planeGeometry args={[(cardScale * 271) / 395, cardScale, 1]} />
    </mesh>
  );
});

RenderCardBack.displayName = "RenderCardBack";

interface CardBackMaterialProps {
  hover?: boolean;
}

const CardBackMaterial = memo(({ hover }: CardBackMaterialProps) => {
  const backTexture = useTexture(textureCardBack);

  const springs = useSpring({
    emissiveIntensity: hover ? 0.03 : 0,
  });

  return (
    <AnimatedMeshStandardMaterial
      map={backTexture}
      metalness={0}
      roughness={0.5}
      emissive={0xffffff}
      emissiveIntensity={springs.emissiveIntensity}
    />
  );
});

type RenderCardOverlayProps = {
  actions: (CardAction | CardActionBundle)[];
};

function RenderCardOverlay({ actions }: RenderCardOverlayProps) {
  const idle = useGameStore((s) => s.events.length === 0);
  const hasActivateOrSS = useMemo(() => {
    return actions.some(
      (a) =>
        a.kind === "activate" ||
        a.kind === "specialSummon" ||
        a.kind === "many_activate" ||
        a.kind === "many_specialSummon",
    );
  }, [actions]);

  if (actions.length === 0 || !idle) {
    return null;
  }

  return (
    <>
      <AnimatedCardActionsOverlay isGold={hasActivateOrSS} />
      <AnimatedCardActionsOverlay isGold={hasActivateOrSS} isBack />
    </>
  );
}

interface AnimatedCardActionsOverlayProps {
  isGold?: boolean;
  isBack?: boolean;
}

function AnimatedCardActionsOverlay({
  isGold,
  isBack,
}: AnimatedCardActionsOverlayProps) {
  const ref = useRef<Mesh>(null);
  const refMaterial = useRef<MeshStandardMaterial>(null);

  const overlayTexture = useTexture(textureHighlight);
  const color = isGold ? 0xfaf148 : 0x79a6d9;

  useEffect(() => {
    if (!ref.current || !refMaterial.current) {
      return;
    }
    animate(
      [
        [ref.current.scale, { x: [1, 1.005], y: [1, 1.005] }, { at: 0 }],
        [refMaterial.current, { opacity: [0.8, 0.9] }, { at: 0 }],
      ],
      {
        repeat: Infinity,
        repeatType: "reverse",
        duration: 0.5,
        type: "keyframes",
        ease: "easeInOut",
      },
    );
  });

  return (
    <mesh
      ref={ref}
      rotation-y={isBack ? 180 * degToRad : 0}
      position-z={isBack ? 0.001 : -0.001}
      scale={1}
    >
      <meshStandardMaterial
        ref={refMaterial}
        color={color}
        alphaMap={overlayTexture}
        depthWrite={false}
        opacity={0.8}
        transparent
      />
      <planeGeometry args={[cardScale * 1.24, cardScale * 1.26, 1]} />
    </mesh>
  );
}

interface GameWrapperProps extends ComponentPropsWithRef<"div"> {}

function GameWrapper({ className, ...props }: GameWrapperProps) {
  return (
    <div
      className={cn(
        "relative bg-gray-700 aspect-video w-full m-auto horizontal:h-full horizontal:w-auto @container",
        className,
      )}
      {...props}
    />
  );
}

function useAllCards() {
  const players = useGameStore((s) => s.players);
  return useMemo(() => {
    const ret: CardInfo[] = [];
    for (const p of players) {
      if (p.field.fieldZone) {
        ret.push(p.field.fieldZone);
      }
      ret.push(...p.field.mainMonsterZone.filter((c): c is CardInfo => !!c));
      ret.push(...p.field.spellZone.filter((c): c is CardInfo => !!c));
      ret.push(...p.field.extraMonsterZone.filter((c): c is CardInfo => !!c));
      ret.push(...p.field.deck);
      ret.push(...p.field.hand);
      ret.push(...p.field.grave);
      ret.push(...p.field.extra);
      ret.push(...p.field.banish);
    }
    return ret;
  }, [players]);
}

// type TestMaterialProps = ShaderMaterialProps & {};

// function TestMaterial({ ...props }: TestMaterialProps) {
//   const [uniforms] = useState(() => {
//     return UniformsUtils.merge([
//       ShaderLib.standard.uniforms,
//       { cameraLengthInverse: { value: 0 } },
//     ]);
//   });

//   const camera = useThree((s) => s.camera);

//   const ref = useRef<ShaderMaterial>(null);

//   useFrame(() => {
//     if (!ref.current) {
//       return;
//     }
//     ref.current.uniforms.cameraLengthInverse.value =
//       1 / camera.position.length();
//   });

//   return (
//     <shaderMaterial
//       ref={ref}
//       onBeforeCompile={(shader) => {
//         shader.vertexShader = shader.vertexShader.replace(
//           "void main() {",
//           `
//           uniform float cameraLengthInverse;
//           void main() {
//         `
//         );
//         shader.vertexShader = shader.vertexShader.replace(
//           "#include <project_vertex>",
//           `
// vec4 mvPosition = vec4( transformed, 1.0 );
// #ifdef USE_BATCHING
//   mvPosition = batchingMatrix * mvPosition;
// #endif
// #ifdef USE_INSTANCING
//   mvPosition = instanceMatrix * mvPosition;
// #endif

// mvPosition = modelViewMatrix * mvPosition;

// gl_Position = projectionMatrix * mvPosition;
//         `
//         );
//       }}
//       lights
//       vertexColors
//       uniforms={uniforms}
//       vertexShader={ShaderLib.standard.vertexShader}
//       fragmentShader={ShaderLib.standard.fragmentShader}
//       extensions={
//         {
//           derivatives: true,
//           fragDepth: false,
//           drawBuffers: false,
//           shaderTextureLOD: false,
//         } as any
//       }
//       {...props}
//     />
//   );
// }
