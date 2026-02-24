function stripCodeFences(raw: string): string {
    return raw.replace(/```(?:json)?/gi, '').trim();
}

function findBalancedJsonEnd(text: string, start: number): number {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === '{') {
            stack.push('}');
            continue;
        }

        if (ch === '[') {
            stack.push(']');
            continue;
        }

        if (ch === '}' || ch === ']') {
            const expected = stack.pop();
            if (expected !== ch) {
                return -1;
            }
            if (stack.length === 0) {
                return i;
            }
        }
    }

    return -1;
}

export function extractFirstJsonPayload(raw: string): string | null {
    const clean = stripCodeFences(raw);
    if (!clean) return null;

    if (
        (clean.startsWith('{') && clean.endsWith('}')) ||
        (clean.startsWith('[') && clean.endsWith(']'))
    ) {
        try {
            JSON.parse(clean);
            return clean;
        } catch {
            // Continue scanning for a valid JSON block.
        }
    }

    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (ch !== '{' && ch !== '[') continue;

        const end = findBalancedJsonEnd(clean, i);
        if (end < 0) continue;

        const candidate = clean.slice(i, end + 1);
        try {
            JSON.parse(candidate);
            return candidate;
        } catch {
            // Try the next candidate block.
        }
    }

    return null;
}

export function parseFirstJsonObject(raw: string): Record<string, unknown> | null {
    const payload = extractFirstJsonPayload(raw);
    if (!payload) return null;

    try {
        const parsed = JSON.parse(payload);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}
