'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

export interface ApiCodeConsoleProps {
  method?: string;
  path?: string;
  pageId: string;
}

type ResponseKind = 'success' | 'error';

const ERROR_RESPONSE = `{
  "error": {
    "code": "bad_request",
    "message": "The request could not be processed."
  }
}`;

function buildRequest(method: string, path: string) {
  const body =
    method === 'GET' || method === 'DELETE'
      ? ''
      : ` \\
  --header 'Content-Type: application/json' \\
  --data '{}'`;

  return `curl --request ${method} \\
  --url '${path}'${body}`;
}

function buildResponse(method: string, path: string) {
  return JSON.stringify({ status: 'ok', method, path }, null, 2);
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" stroke="currentColor" />
      <path
        d="M13.5 6.5V5A1.5 1.5 0 0 0 12 3.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5"
        stroke="currentColor"
      />
    </svg>
  );
}

export function ApiCodeConsole({
  method = 'POST',
  path = '/api/resource',
  pageId,
}: ApiCodeConsoleProps) {
  const normalizedMethod = method.toUpperCase();
  const successStatus = normalizedMethod === 'POST' ? '201' : '200';
  const fallbackRequest = useMemo(
    () => buildRequest(normalizedMethod, path),
    [normalizedMethod, path],
  );
  const fallbackResponse = useMemo(
    () => buildResponse(normalizedMethod, path),
    [normalizedMethod, path],
  );
  const [requestCode, setRequestCode] = useState(fallbackRequest);
  const [requestTitle, setRequestTitle] = useState('Request');
  const [successResponse, setSuccessResponse] = useState(fallbackResponse);
  const [responseKind, setResponseKind] = useState<ResponseKind>('success');
  const [requestCopied, setRequestCopied] = useState(false);
  const [responseCopied, setResponseCopied] = useState(false);
  const requestCopyTimer = useRef<number | undefined>(undefined);
  const responseCopyTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const page = document.getElementById(pageId);
    const codeBlocks = page
      ? Array.from(page.querySelectorAll<HTMLElement>('.api-page-body pre')).map((pre) =>
          (pre.textContent ?? '').trim(),
        )
      : [];
    const requestIndex = codeBlocks.findIndex((content) => /\bcurl\b/i.test(content));
    const extractedRequest = requestIndex >= 0 ? codeBlocks[requestIndex] : undefined;
    const extractedResponse =
      requestIndex >= 0
        ? codeBlocks.slice(requestIndex + 1).find((content) => /^[\[{]/.test(content))
        : undefined;

    setRequestCode(extractedRequest || fallbackRequest);
    setSuccessResponse(extractedResponse || fallbackResponse);
    const pageTitle = document.querySelector<HTMLElement>('#nd-page.api-docs-page > h1')?.textContent?.trim();
    if (pageTitle) setRequestTitle(pageTitle);
  }, [fallbackRequest, fallbackResponse, pageId]);

  useEffect(
    () => () => {
      window.clearTimeout(requestCopyTimer.current);
      window.clearTimeout(responseCopyTimer.current);
    },
    [],
  );

  const responseCode = responseKind === 'success' ? successResponse : ERROR_RESPONSE;

  async function copyCode(
    value: string,
    setCopied: (copied: boolean) => void,
    timer: MutableRefObject<number | undefined>,
  ) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside className="api-code-console" aria-label="API code examples">
      <section className="api-console-card api-console-request-card">
        <header className="api-console-header">
          <span className="api-console-title">{requestTitle}</span>
          <div className="api-console-tools">
            <span className="api-console-language">cURL</span>
            <button
              type="button"
              className="api-console-copy"
              aria-label={requestCopied ? 'Request copied' : 'Copy request'}
              data-copied={requestCopied || undefined}
              onClick={() => copyCode(requestCode, setRequestCopied, requestCopyTimer)}
            >
              <CopyIcon />
              <span className="api-console-copy-text">{requestCopied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </header>
        <pre className="api-console-code">
          <code className="api-code-content">{requestCode}</code>
        </pre>
      </section>

      <section className="api-console-card api-console-response-card">
        <header className="api-console-header api-console-response-header">
          <div className="api-console-tabs" role="tablist" aria-label="Response status">
            <button
              type="button"
              id={`${pageId}-response-${successStatus}-tab`}
              className="api-console-tab"
              role="tab"
              aria-selected={responseKind === 'success'}
              aria-controls={`${pageId}-response-panel`}
              data-active={responseKind === 'success' || undefined}
              onClick={() => setResponseKind('success')}
            >
              {successStatus}
            </button>
            <button
              type="button"
              id={`${pageId}-response-400-tab`}
              className="api-console-tab"
              role="tab"
              aria-selected={responseKind === 'error'}
              aria-controls={`${pageId}-response-panel`}
              data-active={responseKind === 'error' || undefined}
              onClick={() => setResponseKind('error')}
            >
              400
            </button>
          </div>
          <button
            type="button"
            className="api-console-copy"
            aria-label={responseCopied ? 'Response copied' : 'Copy response'}
            data-copied={responseCopied || undefined}
            onClick={() => copyCode(responseCode, setResponseCopied, responseCopyTimer)}
          >
            <CopyIcon />
            <span className="api-console-copy-text">{responseCopied ? 'Copied' : 'Copy'}</span>
          </button>
        </header>
        <pre
          id={`${pageId}-response-panel`}
          className="api-console-code"
          role="tabpanel"
          aria-labelledby={`${pageId}-response-${responseKind === 'success' ? successStatus : '400'}-tab`}
        >
          <code className="api-code-content">{responseCode}</code>
        </pre>
      </section>
    </aside>
  );
}
