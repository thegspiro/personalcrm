"use client";

import * as React from "react";
import type { WeekStart } from "@/lib/calendar-grid";

/**
 * Which day the account's calendars begin on, for the client components that
 * draw one.
 *
 * A context rather than a prop threaded down from each page. The date picker
 * that needs this sits at the bottom of six different chains — a page, a
 * sheet, a floating button rendered by the app shell — and passing one number
 * through every link means twelve files whose only job is to hand it on. Miss
 * one and the picker quietly reverts to Sunday while the calendar page shows
 * Monday, which is the exact disagreement `toWeekStart` exists to prevent.
 *
 * It holds a display preference read on the server at render time, not data:
 * nothing is fetched here, nothing is cached, and a tree rendered outside the
 * provider simply gets Sunday.
 */
const WeekStartContext = React.createContext<WeekStart>(0);

export function WeekStartProvider({
  value,
  children,
}: {
  value: WeekStart;
  children: React.ReactNode;
}) {
  return <WeekStartContext.Provider value={value}>{children}</WeekStartContext.Provider>;
}

export function useWeekStart(): WeekStart {
  return React.useContext(WeekStartContext);
}
