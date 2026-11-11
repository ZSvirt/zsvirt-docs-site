'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ApiCodeConsole } from '@/components/api-code-console';
import { cn } from '@/lib/cn';

const METHOD_STYLES: Record<string, string> = {
  GET: 'api-method-get',
  POST: 'api-method-post',
  PUT: 'api-method-put',
  DELETE: 'api-method-delete',
  PATCH: 'api-method-patch',
};

type APIPageProps = {
  method?: string;
  path?: string;
  altPaths?: string[];
  children: ReactNode;
};

function renderPath(path: string) {
  const segments = path.split(/(\{[^}]+\})/g).filter(Boolean);

  return segments.map((segment, index) => {
    if (segment.startsWith('{') && segment.endsWith('}')) {
      return (
        <span key={`${segment}-${index}`} className="api-path-param">
          {segment}
        </span>
      );
    }

    return <span key={`${segment}-${index}`}>{segment}</span>;
  });
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

type ApiPlaygroundProps = {
  method: string;
  path: string;
  open: boolean;
  onClose: () => void;
};

function ApiPlayground({ method, path, open, onClose }: ApiPlaygroundProps) {
  const [demoSent, setDemoSent] = useState(false);
  const pathParameters = useMemo(
    () => [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
    [path],
  );

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="api-playground-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="api-playground" role="dialog" aria-modal="true" aria-label="API playground">
        <header className="api-playground-header">
          <div>
            <span className={cn('api-method', METHOD_STYLES[method] ?? 'api-method-default')}>
              {method}
            </span>
            <strong>API Playground</strong>
          </div>
          <button type="button" className="api-playground-close" onClick={onClose} aria-label="Close API playground">
            <CloseIcon />
          </button>
        </header>

        <div className="api-playground-endpoint">
          <code>/zstack{path}</code>
          <button type="button" onClick={() => setDemoSent(true)}>Send</button>
        </div>

        <div className="api-playground-form">
          <label>
            <span>Authorization</span>
            <input type="text" placeholder="OAuth session UUID" autoComplete="off" />
          </label>

          {pathParameters.map((parameter) => (
            <label key={parameter}>
              <span>{parameter}</span>
              <input type="text" placeholder={`Enter ${parameter}`} autoComplete="off" />
            </label>
          ))}

          <label>
            <span>Body</span>
            <textarea rows={8} defaultValue={'{\n  "params": {}\n}'} spellCheck={false} />
          </label>

          <p className="api-playground-note" role="status">
            {demoSent ? 'Demo only — no request was sent.' : 'Interactive preview only. Requests are not sent from this documentation.'}
          </p>
        </div>
      </section>
    </div>
  );
}

export function APIPage({ method, path, altPaths = [], children }: APIPageProps) {
  const normalizedMethod = method?.toUpperCase() ?? 'GET';
  const paths = path
    ? [path, ...altPaths.filter((item) => item && item !== path)]
    : [];
  const generatedId = useId().replace(/:/g, '');
  const pageId = `api-page-${generatedId}`;
  const [playgroundOpen, setPlaygroundOpen] = useState(false);

  return (
    <div className="api-page" id={pageId}>
      {paths.length > 0 ? (
        <div className="api-endpoint-bar" aria-label="API endpoint">
          {paths.map((endpointPath, index) => (
            <div
              key={endpointPath}
              className={cn('api-endpoint-row', index > 0 && 'api-endpoint-row-alt')}
            >
              <span
                className={cn('api-method', METHOD_STYLES[normalizedMethod] ?? 'api-method-default')}
              >
                {normalizedMethod}
              </span>
              <code className="api-path">
                <span className="api-path-prefix">/zstack</span>
                {renderPath(endpointPath)}
              </code>
              {index === 0 ? (
                <button type="button" className="api-try-button" onClick={() => setPlaygroundOpen(true)}>
                  Try it
                  <ArrowIcon />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <ApiCodeConsole method={normalizedMethod} path={path} pageId={pageId} />
      <div className="api-page-body">{children}</div>

      {path ? (
        <ApiPlayground
          method={normalizedMethod}
          path={path}
          open={playgroundOpen}
          onClose={() => setPlaygroundOpen(false)}
        />
      ) : null}
    </div>
  );
}
