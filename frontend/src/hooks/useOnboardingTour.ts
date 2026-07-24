import { useCallback, useEffect, useState } from 'react'
import { STATUS } from 'react-joyride'
import type { EventData, Step } from 'react-joyride'
import { useStore } from '../state/store'

const STORAGE_KEY = 'bla-tour-completed'

const FINISHED_STATUSES: string[] = [STATUS.FINISHED, STATUS.SKIPPED]

// The sidebar is `position: fixed` in its off-canvas drawer form (see
// Sidebar.tsx), but every `data-tour` target below is a plain `<div>`
// *inside* it — Joyride infers fixed-position handling from the target's own
// computed `position`, not an ancestor's, so it otherwise picks the wrong
// calculation branch and mis-measures the spotlight. `isFixed: true` forces
// the correct branch. Safe on desktop too: the app has no page-level scroll
// at all (`overflow-hidden` on the root), so the fixed-vs-static branches
// compute identically here regardless of the sidebar's actual position mode.
const SIDEBAR_STEP: Partial<Step> = { isFixed: true, placement: 'right' }

export const TOUR_STEPS: Step[] = [
  {
    target: '[data-tour="map"]',
    title: 'The map',
    content:
      'Pan and zoom freely, and click any parcel to select it — the sidebar fills in with its details.',
    placement: 'center',
  },
  {
    ...SIDEBAR_STEP,
    target: '[data-tour="parcel-search"]',
    title: 'Search for a parcel',
    content:
      'Search by ID, owner name, or address — or skip this and just click a parcel directly on the map.',
  },
  {
    ...SIDEBAR_STEP,
    target: '[data-tour="buffer-sliders"]',
    title: 'Setback distances',
    content:
      "Drag any slider to change a constraint's buffer distance. The map and the breakdown below update live while you drag, not after you let go.",
  },
  {
    ...SIDEBAR_STEP,
    target: '[data-tour="draw-tools"]',
    title: 'Draw tools',
    content:
      "Draw a custom area directly on the map to exclude it, or restore area you've carved out. Click to place points, then close the shape by clicking the first point again.",
  },
  {
    ...SIDEBAR_STEP,
    target: '[data-tour="breakdown-table"]',
    title: 'Area breakdown',
    content:
      'See exactly how many acres each constraint removes. The rows always sum to the total removed — that\'s checkable by eye.',
  },
  {
    ...SIDEBAR_STEP,
    target: '[data-tour="layer-toggles"]',
    title: 'Map layers',
    content:
      'Toggle any layer on or off — wetlands, floodplain, easements, buildings, and the buildable/excluded overlay itself.',
  },
  {
    ...SIDEBAR_STEP,
    target: '[data-tour="reset-button"]',
    title: 'Reset',
    content: "Reset every slider to its default and clear anything you've drawn, any time.",
    placement: 'top',
  },
]

/**
 * Drives the first-visit onboarding tour: auto-starts once (persisted via
 * localStorage so it never nags a returning user), and exposes `startTour`
 * for the help button to manually replay it.
 */
export function useOnboardingTour() {
  const [run, setRun] = useState(false)

  // Below `lg` the sidebar is an off-canvas drawer with a 300ms slide-in
  // transition (see Sidebar.tsx's `max-lg:transition-transform`). Joyride
  // measures target positions as soon as `run` flips true, so opening the
  // sidebar and starting the tour in the same tick can spotlight a
  // mid-animation (wrong) rect. Waiting out the transition first fixes that;
  // on `lg`+ the sidebar has no transition at all, so this wait is harmless.
  const SIDEBAR_TRANSITION_MS = 400

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return
    let startTimer: ReturnType<typeof setTimeout> | undefined
    // Initial delay so the map has finished its own layout before the first
    // step (target: the map itself) tries to spotlight it.
    const openTimer = setTimeout(() => {
      useStore.getState().setSidebarOpen(true)
      startTimer = setTimeout(() => setRun(true), SIDEBAR_TRANSITION_MS)
    }, 600)
    return () => {
      clearTimeout(openTimer)
      clearTimeout(startTimer)
    }
  }, [])

  const handleEvent = useCallback((data: EventData) => {
    if (FINISHED_STATUSES.includes(data.status)) {
      setRun(false)
      localStorage.setItem(STORAGE_KEY, '1')
    }
  }, [])

  const startTour = useCallback(() => {
    useStore.getState().setSidebarOpen(true)
    setTimeout(() => setRun(true), SIDEBAR_TRANSITION_MS)
  }, [])

  return { run, steps: TOUR_STEPS, handleEvent, startTour }
}
