// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';

type CopyState = 'idle' | 'copied' | 'failed';

const RESET_MS = 2500;

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), RESET_MS);
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      {state === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {state === 'copied' ? 'Copied' : label}
      <span className="sr-only" role="status">
        {state === 'copied' ? 'Copied to the clipboard' : ''}
        {state === 'failed' ? 'Copy failed. Select the text and copy it by hand.' : ''}
      </span>
    </Button>
  );
}

export function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <CopyButton text={code} label={`Copy ${title.toLowerCase()}`} />
      </div>
      <section
        aria-label={title}
        // A scrollable region must be reachable by keyboard (WCAG 2.1.1, axe scrollable-region-focusable).
        // biome-ignore lint/a11y/noNoninteractiveTabindex: scrolling needs focus
        tabIndex={0}
        className="overflow-x-auto rounded-md border bg-muted"
      >
        <pre className="p-3 font-mono text-xs leading-relaxed">
          <code>{code}</code>
        </pre>
      </section>
    </div>
  );
}
