import { ChatWidget } from './components/chat-widget';
import { BackendCodePanel, FrontendCodePanel } from './components/code-panel';

export default function Home() {
  return (
    <main className="mx-auto flex h-dvh max-w-7xl flex-col gap-4 overflow-hidden px-6 py-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold">Chat widget demo</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          A live chat with a Seavoice AI agent, plus the exact code you&apos;d copy into your own
          site to embed it.
        </p>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 md:grid-cols-3">
        <ChatWidget />
        <BackendCodePanel />
        <FrontendCodePanel />
      </div>
    </main>
  );
}
