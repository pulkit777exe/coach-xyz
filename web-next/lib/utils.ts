type StateFn = (state: any) => string | undefined;

type StaticValue =
  | string
  | number
  | bigint
  | false
  | null
  | undefined
  | Record<string, boolean>;

type ClassValue = StaticValue | StateFn;

function flattenClasses(input: StaticValue): string[] {
  if (!input) return [];
  if (typeof input === "object") {
    const out: string[] = [];
    for (const [cls, on] of Object.entries(input)) {
      if (on) out.push(cls);
    }
    return out;
  }
  return [String(input)];
}

export function cn(...inputs: StaticValue[]): string;
export function cn(...inputs: ClassValue[]): string | StateFn;
export function cn(...inputs: ClassValue[]) {
  const staticParts: string[] = [];
  const dynamicParts: StateFn[] = [];

  for (const input of inputs) {
    if (typeof input === "function") {
      dynamicParts.push(input);
    } else {
      staticParts.push(...flattenClasses(input));
    }
  }

  if (dynamicParts.length === 0) {
    return staticParts.join(" ");
  }

  return (state: any) => {
    const dynamic = dynamicParts
      .map((fn) => fn(state))
      .filter(Boolean)
      .join(" ");
    return [...staticParts, dynamic].filter(Boolean).join(" ");
  };
}