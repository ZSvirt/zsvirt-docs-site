import { DevConsoleFilter } from '@/components/dev-console-filter';
import { AppProviders } from '@/components/app-providers';
import type { ReactNode } from 'react';
import './global.css';
import './zsphere-foundation.css';
import './zsphere-shell.css';
import './zsphere-content.css';
import './zsphere-api.css';


export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <DevConsoleFilter />
        <AppProviders
          theme={{
            attribute: 'class',
            defaultTheme: 'system',
            enableSystem: true,
          }}
        >
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
