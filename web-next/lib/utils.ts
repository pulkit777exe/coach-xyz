type StateFn<S> = (state: S) => string | undefined

export function capitalize(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1)
}

type StaticValue = string | number | bigint | false | null | undefined | Record<string, boolean>

type ClassValue<S> = StaticValue | StateFn<S>

function flattenClasses(input: StaticValue): string[] {
  if (!input) return []
  if (typeof input === 'object') {
    const out: string[] = []
    for (const [cls, on] of Object.entries(input)) {
      if (on) out.push(cls)
    }
    return out
  }
  return [String(input)]
}

export function cn(...inputs: StaticValue[]): string
export function cn<S>(...inputs: ClassValue<S>[]): string | StateFn<S>
export function cn<S>(...inputs: ClassValue<S>[]) {
  const staticParts: string[] = []
  const dynamicParts: StateFn<S>[] = []

  for (const input of inputs) {
    if (typeof input === 'function') {
      dynamicParts.push(input)
    } else {
      staticParts.push(...flattenClasses(input))
    }
  }

  if (dynamicParts.length === 0) {
    return staticParts.join(' ')
  }

  return (state: S) => {
    const dynamic = dynamicParts
      .map((fn) => fn(state))
      .filter(Boolean)
      .join(' ')
    return [...staticParts, dynamic].filter(Boolean).join(' ')
  }
}
