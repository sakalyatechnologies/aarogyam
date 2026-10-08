import { m, useInView, type MotionStyle, type Variants } from "motion/react";
import { createContext, useContext, useRef, useState, type MouseEvent, type ReactNode } from "react";

const LIST: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const ITEM: Variants = {
  hidden: { opacity: 0, x: -14 },
  show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

/** True once the list's entrance has played: rows added later (a refetch, "show more") appear without it. */
const Entered = createContext(false);

/** What the lists here pass through to the element: enough for a list, a table body or a clickable row. */
interface Passed {
  className?: string;
  style?: MotionStyle;
  children?: ReactNode;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  [data: `data-${string}`]: string | number | undefined;
}

/**
 * A list whose rows slide in one after another the first time it scrolls into view. It plays once
 * per mount, so a query refetch that re-renders the rows doesn't replay it. Rows are `StaggerItem`s;
 * other children (say, a timeline's hour marks) stay still.
 */
export function StaggerList({ as, ...rest }: Passed & { as: "ul" | "ol" | "tbody" }) {
  const ref = useRef<HTMLUListElement & HTMLOListElement & HTMLTableSectionElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.05 });
  const [entered, setEntered] = useState(false);
  const motionProps = {
    ref,
    variants: LIST,
    initial: "hidden",
    animate: inView ? "show" : "hidden",
    onAnimationComplete: (definition: unknown) => {
      if (definition === "show") {
        setEntered(true);
      }
    },
  };
  const list = as === "ol" ? <m.ol {...rest} {...motionProps} /> : as === "tbody" ? <m.tbody {...rest} {...motionProps} /> : <m.ul {...rest} {...motionProps} />;
  return <Entered value={entered}>{list}</Entered>;
}

/** One row of a `StaggerList`. */
export function StaggerItem({ as, ...rest }: Passed & { as: "li" | "tr" }) {
  const entered = useContext(Entered);
  const motionProps = { variants: ITEM, ...(entered ? { initial: false as const } : {}) };
  return as === "tr" ? <m.tr {...rest} {...motionProps} /> : <m.li {...rest} {...motionProps} />;
}
