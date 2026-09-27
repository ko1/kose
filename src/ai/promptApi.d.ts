// Chrome Built-in Prompt API の最小限の型定義。
// API名の変更（inputQuota → contextWindow 等）に備え、両方の名前を任意プロパティとして宣言する。

type LanguageModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface LanguageModelExpected {
  type: 'text';
  languages?: string[];
}

interface LanguageModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LanguageModelCreateMonitor extends EventTarget {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: Event & { loaded: number; total?: number }) => void,
  ): void;
}

interface LanguageModelOptions {
  expectedInputs?: LanguageModelExpected[];
  expectedOutputs?: LanguageModelExpected[];
}

interface LanguageModelCreateOptions extends LanguageModelOptions {
  initialPrompts?: LanguageModelMessage[];
  signal?: AbortSignal;
  monitor?: (m: LanguageModelCreateMonitor) => void;
}

interface LanguageModelPromptOptions {
  responseConstraint?: Record<string, unknown>;
  omitResponseConstraintInput?: boolean;
  signal?: AbortSignal;
}

interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  promptStreaming?(input: string, options?: LanguageModelPromptOptions): ReadableStream<string>;
  measureInputUsage?(input: string, options?: LanguageModelPromptOptions): Promise<number>;
  measureContextUsage?(input: string, options?: LanguageModelPromptOptions): Promise<number>;
  inputQuota?: number;
  inputUsage?: number;
  contextWindow?: number;
  contextUsage?: number;
  clone?(options?: { signal?: AbortSignal }): Promise<LanguageModelSession>;
  destroy(): void;
}

interface LanguageModelStatic {
  availability(options?: LanguageModelOptions): Promise<LanguageModelAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

declare var LanguageModel: LanguageModelStatic | undefined;
