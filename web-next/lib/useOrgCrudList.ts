// ── Shared org CRUD list ─────────────────────────────────────────────────────
// One home for the load → create → setStatus → remove loop repeated by the
// training-loop sections (objectives, plans, wellness check-ins): a
// race-guarded initial load plus one busy/error shape for every mutation.
// Sections keep their bespoke state (dialogs, filters, fan-out fetches) and
// drive this hook for the list itself. The reducer is pure and unit-tested;
// the hook is a thin effect + dispatch shell over it.

import { useEffect, useReducer, useRef, type Reducer } from 'react'

export type CrudItem = { id: string }

export type CrudListState<T> = {
  items: T[]
  /** False until the initial load settles (success or failure). */
  hasLoaded: boolean
  isBusy: boolean
  error: string | null
}

export type CrudListAction<T> =
  | { type: 'loaded'; items: T[] }
  | { type: 'loadFailed' }
  | { type: 'busy'; busy: boolean }
  | { type: 'created'; item: T }
  | { type: 'updated'; item: T }
  | { type: 'removed'; id: string }
  | { type: 'failed'; message: string }
  | { type: 'clearError' }

export const crudListInit = <T>(): CrudListState<T> => ({
  items: [],
  hasLoaded: false,
  isBusy: false,
  error: null,
})

export function crudListReducer<T extends CrudItem>(
  state: CrudListState<T>,
  action: CrudListAction<T>,
): CrudListState<T> {
  switch (action.type) {
    case 'loaded':
      return { ...state, items: action.items, hasLoaded: true }
    case 'loadFailed':
      return { ...state, items: [], hasLoaded: true }
    case 'busy':
      return { ...state, isBusy: action.busy }
    case 'created':
      return { ...state, items: [action.item, ...state.items] }
    case 'updated':
      return {
        ...state,
        items: state.items.map((item) => (item.id === action.item.id ? action.item : item)),
      }
    case 'removed':
      return { ...state, items: state.items.filter((item) => item.id !== action.id) }
    case 'failed':
      return { ...state, error: action.message }
    case 'clearError':
      return { ...state, error: null }
  }
}

export const crudErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback

export function useOrgCrudList<T extends CrudItem, C, S>(opts: {
  /** Reruns the initial load when this changes (e.g. auth0Id + studentId). */
  scopeKey: string
  load: () => Promise<T[]>
  create: (input: C) => Promise<T>
  setStatus?: (id: string, status: S) => Promise<T>
  remove?: (id: string) => Promise<unknown>
  /** Extra load-failure handling (e.g. mapping 403 to a denied flag). */
  onLoadError?: (error: unknown) => void
}) {
  const [state, dispatch] = useReducer(
    crudListReducer as Reducer<CrudListState<T>, CrudListAction<T>>,
    crudListInit<T>(),
  )
  const loadRef = useRef(opts.load)
  const createRef = useRef(opts.create)
  const setStatusRef = useRef(opts.setStatus)
  const removeRef = useRef(opts.remove)
  const onLoadErrorRef = useRef(opts.onLoadError)

  // Latest-callback refs (written in an effect — never during render).
  useEffect(() => {
    loadRef.current = opts.load
    createRef.current = opts.create
    setStatusRef.current = opts.setStatus
    removeRef.current = opts.remove
    onLoadErrorRef.current = opts.onLoadError
  })

  useEffect(() => {
    let cancelled = false
    void loadRef.current().then(
      (items) => {
        if (!cancelled) dispatch({ type: 'loaded', items })
      },
      (error: unknown) => {
        if (cancelled) return
        onLoadErrorRef.current?.(error)
        dispatch({ type: 'loadFailed' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [opts.scopeKey])

  const setError = (message: string | null) =>
    dispatch(message === null ? { type: 'clearError' } : { type: 'failed', message })

  const createItem = async (input: C, fallback: string): Promise<T | null> => {
    dispatch({ type: 'busy', busy: true })
    dispatch({ type: 'clearError' })
    try {
      const item = await createRef.current(input)
      dispatch({ type: 'created', item })
      return item
    } catch (error) {
      dispatch({ type: 'failed', message: crudErrorMessage(error, fallback) })
      return null
    } finally {
      dispatch({ type: 'busy', busy: false })
    }
  }

  const setItemStatus = async (id: string, status: S): Promise<void> => {
    const setStatus = setStatusRef.current
    if (!setStatus) return
    dispatch({ type: 'busy', busy: true })
    try {
      const item = await setStatus(id, status)
      dispatch({ type: 'updated', item })
    } catch (error) {
      dispatch({ type: 'failed', message: crudErrorMessage(error, 'Could not update.') })
    } finally {
      dispatch({ type: 'busy', busy: false })
    }
  }

  const removeItem = async (id: string): Promise<void> => {
    const remove = removeRef.current
    if (!remove) return
    dispatch({ type: 'busy', busy: true })
    try {
      await remove(id)
      dispatch({ type: 'removed', id })
    } catch (error) {
      dispatch({ type: 'failed', message: crudErrorMessage(error, 'Could not delete.') })
    } finally {
      dispatch({ type: 'busy', busy: false })
    }
  }

  return {
    items: state.items,
    isLoading: !state.hasLoaded,
    isBusy: state.isBusy,
    error: state.error,
    setError,
    createItem,
    setItemStatus,
    removeItem,
  }
}
